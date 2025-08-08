// Utilitários para padronizar respostas da API
// Centraliza a lógica de formatação de respostas para reduzir duplicação

/**
 * Resposta de sucesso padrão
 * @param {Object} res - Response object do Express
 * @param {Object} data - Dados a serem retornados
 * @param {string} message - Mensagem de sucesso
 * @param {number} statusCode - Código de status HTTP (padrão: 200)
 */
const successResponse = (res, data = null, message = 'Success', statusCode = 200) => {
  const response = {
    success: true,
    message
  };

  if (data !== null) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
};

/**
 * Resposta de sucesso para criação de recursos
 * @param {Object} res - Response object do Express
 * @param {Object} data - Dados do recurso criado
 * @param {string} message - Mensagem de sucesso
 */
const createdResponse = (res, data, message = 'Resource created successfully') => {
  return successResponse(res, data, message, 201);
};

/**
 * Resposta de sucesso para listagem paginada
 * @param {Object} res - Response object do Express
 * @param {Array} items - Lista de itens
 * @param {Object} pagination - Informações de paginação
 * @param {string} message - Mensagem de sucesso
 */
const paginatedResponse = (res, items, pagination, message = 'Data retrieved successfully') => {
  return successResponse(res, {
    items,
    pagination
  }, message);
};

/**
 * Calcula informações de paginação
 * @param {number} page - Página atual
 * @param {number} limit - Itens por página
 * @param {number} total - Total de itens
 * @returns {Object} Objeto com informações de paginação
 */
const calculatePagination = (page, limit, total) => {
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return {
    currentPage: page,
    totalPages,
    totalItems: total,
    itemsPerPage: limit,
    hasNextPage,
    hasPrevPage
  };
};

module.exports = {
  successResponse,
  createdResponse,
  paginatedResponse,
  calculatePagination
};
