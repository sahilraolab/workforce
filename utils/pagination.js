const { PAGINATION_LIMIT } = require('../config/constants');

function paginate(query, defaultLimit = PAGINATION_LIMIT) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function buildPageData(count, page, limit) {
  const totalPages = Math.ceil(count / limit);
  return {
    total: count,
    page,
    limit,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    prevPage: page - 1,
    nextPage: page + 1,
  };
}

module.exports = { paginate, buildPageData };
