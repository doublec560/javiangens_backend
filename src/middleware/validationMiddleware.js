const { body, param, query, validationResult } = require('express-validator');
const { AppError } = require('./errorMiddleware');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.path,
      message: error.msg,
      value: error.value
    }));
    
    throw new AppError('Validation failed', 400, 'VALIDATION_ERROR', errorMessages);
  }
  
  next();
};

// Authentication validations
const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  handleValidationErrors
];

const validateChangePassword = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Password confirmation does not match');
      }
      return true;
    }),
  handleValidationErrors
];

// User validations
const validateCreateUser = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('role')
    .isIn(['administrador', 'gerente'])
    .withMessage('Role must be either administrador or gerente'),
  handleValidationErrors
];

const validateUpdateUser = [
  param('id')
    .isUUID()
    .withMessage('Invalid user ID format'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('role')
    .optional()
    .isIn(['administrador', 'gerente'])
    .withMessage('Role must be either administrador or gerente'),
  body('status')
    .optional()
    .isBoolean()
    .withMessage('Status must be a boolean value'),
  handleValidationErrors
];

// Profile validations
const validateUpdateProfile = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  handleValidationErrors
];

// Category validations
const validateCategory = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Category name must be between 2 and 100 characters'),
  handleValidationErrors
];

// Subcategory validations
const validateSubcategory = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Subcategory name must be between 2 and 100 characters'),
  body('category_id')
    .isUUID()
    .withMessage('Invalid category ID format'),
  handleValidationErrors
];

// Transaction validations
const validateTransaction = [
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be a positive number'),
  body('type')
    .isIn(['entrada', 'saida'])
    .withMessage('Type must be either entrada or saida'),
  body('description')
    .trim()
    .isLength({ min: 2, max: 500 })
    .withMessage('Description must be between 2 and 500 characters'),
  body('date')
    .isISO8601()
    .withMessage('Please provide a valid date'),
  body('category_id')
    .optional()
    .matches(/^cat-[a-z]+-\d+$/)
    .withMessage('Invalid category ID format'),
  body('subcategory_id')
    .optional()
    .matches(/^sub-[a-z]+-\d+$/)
    .withMessage('Invalid subcategory ID format'),
  body('comprovativo_url')
    .optional(),
  handleValidationErrors
];

// Common validations
const validateUUID = (paramName = 'id') => [
  param(paramName)
    .isUUID()
    .withMessage(`Invalid ${paramName} format`),
  handleValidationErrors
];

// Transaction ID validation (accepts custom format like txn-XXX)
const validateTransactionId = (paramName = 'id') => [
  param(paramName)
    .matches(/^txn-\d+$/)
    .withMessage(`Invalid transaction ${paramName} format`),
  handleValidationErrors
];

// Category ID validation (accepts custom format like cat-XXX-XXX)
const validateCategoryId = (fieldName = 'category_id') => [
  body(fieldName)
    .optional()
    .matches(/^cat-[a-z]+-\d+$/)
    .withMessage(`Invalid category ${fieldName} format`),
  handleValidationErrors
];

// Subcategory ID validation (accepts custom format like sub-XXX-XXX)
const validateSubcategoryId = (fieldName = 'subcategory_id') => [
  body(fieldName)
    .optional()
    .matches(/^sub-[a-z]+-\d+$/)
    .withMessage(`Invalid subcategory ${fieldName} format`),
  handleValidationErrors
];

const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

module.exports = {
  validateLogin,
  validateChangePassword,
  validateCreateUser,
  validateUpdateUser,
  validateUpdateProfile,
  validateCategory,
  validateSubcategory,
  validateTransaction,
  validateUUID,
  validateTransactionId,
  validateCategoryId,
  validateSubcategoryId,
  validatePagination,
  handleValidationErrors
};
