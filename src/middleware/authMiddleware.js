const jwt = require('jsonwebtoken');
const { executeQuery } = require('../config/database');
const { AppError } = require('./errorMiddleware');

// Verify JWT token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Access denied. No token provided.', 401, 'NO_TOKEN');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    if (!token) {
      throw new AppError('Access denied. No token provided.', 401, 'NO_TOKEN');
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const users = await executeQuery(
      `SELECT u.id, u.email, p.name, p.role, p.status 
       FROM users u 
       JOIN profiles p ON u.id = p.id 
       WHERE u.id = ? AND p.status = 1`,
      [decoded.userId]
    );

    if (users.length === 0) {
      throw new AppError('User not found or inactive.', 401, 'USER_NOT_FOUND');
    }

    // Add user to request object
    req.user = {
      id: users[0].id,
      email: users[0].email,
      name: users[0].name,
      role: users[0].role
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(new AppError('Invalid token.', 401, 'INVALID_TOKEN'));
    } else if (error.name === 'TokenExpiredError') {
      next(new AppError('Token expired.', 401, 'TOKEN_EXPIRED'));
    } else {
      next(error);
    }
  }
};

// Check if user has admin role
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required.', 401, 'AUTH_REQUIRED'));
  }

  if (req.user.role !== 'administrador') {
    return next(new AppError('Admin access required.', 403, 'ADMIN_REQUIRED'));
  }

  next();
};

// Check if user has admin or manager role
const requireAdminOrManager = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required.', 401, 'AUTH_REQUIRED'));
  }

  if (!['administrador', 'gerente'].includes(req.user.role)) {
    return next(new AppError('Admin or manager access required.', 403, 'INSUFFICIENT_PERMISSIONS'));
  }

  next();
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const users = await executeQuery(
          `SELECT u.id, u.email, p.name, p.role, p.status 
           FROM users u 
           JOIN profiles p ON u.id = p.id 
           WHERE u.id = ? AND p.status = 1`,
          [decoded.userId]
        );

        if (users.length > 0) {
          req.user = {
            id: users[0].id,
            email: users[0].email,
            name: users[0].name,
            role: users[0].role
          };
        }
      }
    }
    
    next();
  } catch (error) {
    // For optional auth, we don't fail on token errors
    next();
  }
};

module.exports = {
  verifyToken,
  requireAdmin,
  requireAdminOrManager,
  optionalAuth
};
