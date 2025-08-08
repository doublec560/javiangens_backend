// Utilitários de autenticação
// Centraliza lógica comum de autenticação e autorização

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

/**
 * Gera token JWT
 * @param {string} userId - ID do usuário
 * @param {string} type - Tipo do token ('access' ou 'refresh')
 * @returns {string} Token JWT
 */
const generateToken = (userId, type = 'access') => {
  const payload = { userId, type };
  const expiresIn = type === 'refresh' 
    ? process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    : process.env.JWT_EXPIRES_IN || '24h';

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

/**
 * Gera token de acesso
 * @param {string} userId - ID do usuário
 * @returns {string} Token de acesso
 */
const generateAccessToken = (userId) => {
  return generateToken(userId, 'access');
};

/**
 * Gera token de refresh
 * @param {string} userId - ID do usuário
 * @returns {string} Token de refresh
 */
const generateRefreshToken = (userId) => {
  return generateToken(userId, 'refresh');
};

/**
 * Gera hash da senha
 * @param {string} password - Senha em texto plano
 * @returns {Promise<string>} Hash da senha
 */
const hashPassword = async (password) => {
  const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
  return await bcrypt.hash(password, saltRounds);
};

/**
 * Verifica se a senha está correta
 * @param {string} password - Senha em texto plano
 * @param {string} hash - Hash armazenado
 * @returns {Promise<boolean>} True se a senha está correta
 */
const verifyPassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

/**
 * Verifica se o usuário tem permissão para acessar um recurso
 * @param {Object} user - Objeto do usuário
 * @param {Array|string} allowedRoles - Roles permitidos
 * @returns {boolean} True se o usuário tem permissão
 */
const hasPermission = (user, allowedRoles) => {
  if (!user || !user.role) {
    return false;
  }

  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return roles.includes(user.role);
};

/**
 * Verifica se o usuário é administrador
 * @param {Object} user - Objeto do usuário
 * @returns {boolean} True se é administrador
 */
const isAdmin = (user) => {
  return hasPermission(user, 'administrador');
};

/**
 * Verifica se o usuário é administrador ou gerente
 * @param {Object} user - Objeto do usuário
 * @returns {boolean} True se é administrador ou gerente
 */
const isAdminOrManager = (user) => {
  return hasPermission(user, ['administrador', 'gerente']);
};

/**
 * Formata dados do usuário para resposta (remove informações sensíveis)
 * @param {Object} user - Dados do usuário
 * @returns {Object} Dados formatados do usuário
 */
const formatUserResponse = (user) => {
  const { password_hash, ...userWithoutPassword } = user;
  return userWithoutPassword;
};

module.exports = {
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  hashPassword,
  verifyPassword,
  hasPermission,
  isAdmin,
  isAdminOrManager,
  formatUserResponse
};
