const express = require('express');
const { executeQuery } = require('../config/database');
const { AppError } = require('../middleware/errorMiddleware');
const { verifyToken } = require('../middleware/authMiddleware');
const { validateLogin, validateChangePassword } = require('../middleware/validationMiddleware');
const { successResponse } = require('../utils/responseUtils');
const { findResourceOrFail, USER_WITH_PROFILE_QUERY } = require('../utils/queryUtils');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyPassword,
  hashPassword,
  formatUserResponse
} = require('../utils/authUtils');

const router = express.Router();

// POST /api/auth/login
router.post('/login', validateLogin, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const users = await executeQuery(
      `SELECT u.id, u.email, u.password_hash, p.name, p.role, p.status
       FROM users u
       JOIN profiles p ON u.id = p.id
       WHERE u.email = ?`,
      [email]
    );

    if (users.length === 0) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const user = users[0];

    // Check if user is active
    if (!user.status) {
      throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
    }

    // Verify password using utility function
    const isPasswordValid = await verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // Update last login
    await executeQuery(
      'UPDATE profiles SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    // Generate tokens using utility functions
    const token = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Use standardized response
    return successResponse(res, {
      user: formatUserResponse({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }),
      token,
      refreshToken
    }, 'Login successful');
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout
router.post('/logout', verifyToken, async (req, res, next) => {
  try {
    // In a more sophisticated implementation, you would blacklist the token
    // For now, we just return success as the client will remove the token
    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
router.get('/me', verifyToken, async (req, res, next) => {
  try {
    // Get detailed user information using utility query
    const users = await executeQuery(USER_WITH_PROFILE_QUERY, [req.user.id]);

    if (users.length === 0) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const user = formatUserResponse(users[0]);

    return successResponse(res, { user }, 'User profile retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError('Refresh token is required', 400, 'REFRESH_TOKEN_REQUIRED');
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    
    if (decoded.type !== 'refresh') {
      throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    // Check if user still exists and is active
    const users = await executeQuery(
      `SELECT u.id, u.email, p.name, p.role, p.status 
       FROM users u 
       JOIN profiles p ON u.id = p.id 
       WHERE u.id = ? AND p.status = 1`,
      [decoded.userId]
    );

    if (users.length === 0) {
      throw new AppError('User not found or inactive', 401, 'USER_NOT_FOUND');
    }

    const user = users[0];

    // Generate new tokens
    const newToken = generateToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        token: newToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/change-password
router.post('/change-password', verifyToken, validateChangePassword, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get current password hash
    const users = await executeQuery(
      'SELECT password_hash FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, users[0].password_hash);
    if (!isCurrentPasswordValid) {
      throw new AppError('Current password is incorrect', 400, 'INVALID_CURRENT_PASSWORD');
    }

    // Hash new password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await executeQuery(
      'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
      [newPasswordHash, req.user.id]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
