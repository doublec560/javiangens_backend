// Utilitários para construção de queries SQL
// Centraliza lógica comum de queries para reduzir duplicação

const { executeQuery } = require('../config/database');
const { AppError } = require('../middleware/errorMiddleware');

/**
 * Verifica se um recurso existe no banco de dados
 * @param {string} table - Nome da tabela
 * @param {string} id - ID do recurso
 * @param {string} idColumn - Nome da coluna de ID (padrão: 'id')
 * @returns {Promise<boolean>} True se o recurso existe
 */
const resourceExists = async (table, id, idColumn = 'id') => {
  const result = await executeQuery(
    `SELECT ${idColumn} FROM ${table} WHERE ${idColumn} = ? LIMIT 1`,
    [id]
  );
  return result.length > 0;
};

/**
 * Busca um recurso por ID ou lança erro se não encontrado
 * @param {string} table - Nome da tabela
 * @param {string} id - ID do recurso
 * @param {string} errorMessage - Mensagem de erro personalizada
 * @param {string} errorCode - Código de erro personalizado
 * @param {string} idColumn - Nome da coluna de ID (padrão: 'id')
 * @returns {Promise<Object>} Recurso encontrado
 */
const findResourceOrFail = async (table, id, errorMessage = 'Resource not found', errorCode = 'RESOURCE_NOT_FOUND', idColumn = 'id') => {
  const result = await executeQuery(
    `SELECT * FROM ${table} WHERE ${idColumn} = ? LIMIT 1`,
    [id]
  );
  
  if (result.length === 0) {
    throw new AppError(errorMessage, 404, errorCode);
  }
  
  return result[0];
};

/**
 * Constrói query de atualização dinâmica
 * @param {string} table - Nome da tabela
 * @param {Object} updates - Objeto com campos a serem atualizados
 * @param {string} whereClause - Cláusula WHERE
 * @param {Array} whereParams - Parâmetros da cláusula WHERE
 * @returns {Object} Query e parâmetros
 */
const buildUpdateQuery = (table, updates, whereClause, whereParams = []) => {
  const updateFields = [];
  const updateValues = [];

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      updateFields.push(`${key} = ?`);
      updateValues.push(value);
    }
  });

  if (updateFields.length === 0) {
    throw new AppError('No fields to update', 400, 'NO_UPDATE_FIELDS');
  }

  const query = `UPDATE ${table} SET ${updateFields.join(', ')}, updated_at = NOW() WHERE ${whereClause}`;
  const params = [...updateValues, ...whereParams];

  return { query, params };
};

/**
 * Constrói query de busca com filtros opcionais
 * @param {string} baseQuery - Query base
 * @param {Object} filters - Filtros a serem aplicados
 * @param {Array} baseParams - Parâmetros base da query
 * @returns {Object} Query e parâmetros
 */
const buildSearchQuery = (baseQuery, filters = {}, baseParams = []) => {
  const whereClauses = [];
  const queryParams = [...baseParams];

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      if (key.includes('_like')) {
        const column = key.replace('_like', '');
        whereClauses.push(`${column} LIKE ?`);
        queryParams.push(`%${value}%`);
      } else if (key.includes('_date_from')) {
        const column = key.replace('_date_from', '');
        whereClauses.push(`${column} >= ?`);
        queryParams.push(value);
      } else if (key.includes('_date_to')) {
        const column = key.replace('_date_to', '');
        whereClauses.push(`${column} <= ?`);
        queryParams.push(value);
      } else {
        whereClauses.push(`${key} = ?`);
        queryParams.push(value);
      }
    }
  });

  let query = baseQuery;
  if (whereClauses.length > 0) {
    const whereClause = whereClauses.join(' AND ');
    query += query.includes('WHERE') ? ` AND ${whereClause}` : ` WHERE ${whereClause}`;
  }

  return { query, params: queryParams };
};

/**
 * Query padrão para buscar usuário com perfil
 */
const USER_WITH_PROFILE_QUERY = `
  SELECT u.id, u.email, p.name, p.phone, p.role, p.status, p.avatar, p.last_login, p.created_at
  FROM users u 
  JOIN profiles p ON u.id = p.id 
  WHERE u.id = ?
`;

/**
 * Gera próximo ID de transação no formato txn-XXX
 * @returns {Promise<string>} Próximo ID de transação
 */
const generateNextTransactionId = async () => {
  const result = await executeQuery(
    `SELECT id FROM transactions
     WHERE id LIKE 'txn-%'
     ORDER BY CAST(SUBSTRING(id, 5) AS UNSIGNED) DESC
     LIMIT 1`
  );

  if (result.length === 0) {
    return 'txn-001';
  }

  const lastId = result[0].id;
  const lastNumber = parseInt(lastId.split('-')[1]);
  const nextNumber = lastNumber + 1;

  return `txn-${nextNumber.toString().padStart(3, '0')}`;
};

/**
 * Query padrão para buscar transação com relacionamentos
 */
const TRANSACTION_WITH_RELATIONS_QUERY = `
  SELECT
    t.id, t.amount, t.type, t.description, t.date, t.receipt_url as comprovativo_url,
    t.category_id, t.subcategory_id, t.created_at, t.updated_at,
    c.name as category_name,
    s.name as subcategory_name,
    p.name as created_by_name
  FROM transactions t
  LEFT JOIN categories c ON t.category_id = c.id
  LEFT JOIN subcategories s ON t.subcategory_id = s.id
  LEFT JOIN profiles p ON t.created_by = p.id
`;

module.exports = {
  resourceExists,
  findResourceOrFail,
  buildUpdateQuery,
  buildSearchQuery,
  generateNextTransactionId,
  USER_WITH_PROFILE_QUERY,
  TRANSACTION_WITH_RELATIONS_QUERY
};
