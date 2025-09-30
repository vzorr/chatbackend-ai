// utils/pagination.js - Pagination Helper Utilities

const { ADMIN_ACCESS_CONFIG, VALIDATION_RULES } = require('./constants');

/**
 * Pagination utilities for consistent pagination handling across admin endpoints
 */

/**
 * Extract and validate pagination parameters from query string
 * @param {Object} query - Express request query object
 * @returns {Object} Pagination parameters with defaults
 */
const getPaginationParams = (query = {}) => {
  // Extract pagination params with defaults
  let page = parseInt(query.page) || 1;
  let limit = parseInt(query.size || query.limit) || ADMIN_ACCESS_CONFIG.DEFAULT_PAGE_SIZE;
  
  // Validate and enforce limits
  page = Math.max(1, page); // Ensure page is at least 1
  limit = Math.max(
    ADMIN_ACCESS_CONFIG.MIN_PAGE_SIZE,
    Math.min(limit, ADMIN_ACCESS_CONFIG.MAX_PAGE_SIZE)
  );
  
  // Calculate offset
  const offset = (page - 1) * limit;
  
  return {
    page,
    limit,
    offset,
    originalPage: query.page,
    originalLimit: query.size || query.limit
  };
};

/**
 * Extract and validate sorting parameters from query string
 * @param {Object} query - Express request query object
 * @param {string} defaultSortField - Default field to sort by
 * @returns {Object} Sorting parameters
 */
const getSortingParams = (query = {}, defaultSortField = ADMIN_ACCESS_CONFIG.DEFAULT_SORT_FIELD) => {
  const sortBy = query.sortBy || query.sort || defaultSortField;
  let sortOrder = (query.sortOrder || query.order || ADMIN_ACCESS_CONFIG.DEFAULT_SORT_ORDER).toUpperCase();
  
  // Validate sort order
  if (!ADMIN_ACCESS_CONFIG.ALLOWED_SORT_ORDERS.includes(sortOrder.toLowerCase())) {
    sortOrder = ADMIN_ACCESS_CONFIG.DEFAULT_SORT_ORDER;
  }
  
  return {
    sortBy,
    sortOrder,
    orderClause: [[sortBy, sortOrder]]
  };
};

/**
 * Extract and validate search parameters from query string
 * @param {Object} query - Express request query object
 * @returns {Object} Search parameters
 */
const getSearchParams = (query = {}) => {
  let search = query.search || query.q || '';
  
  // Trim and limit search length
  search = search.trim().substring(0, ADMIN_ACCESS_CONFIG.MAX_SEARCH_LENGTH);
  
  return {
    search,
    hasSearch: search.length > 0
  };
};

/**
 * Extract and validate filter parameters from query string
 * @param {Object} query - Express request query object
 * @returns {Object} Filter parameters
 */
const getFilterParams = (query = {}) => {
  let filters = {};
  let filterError = null;
  
  if (query.filters) {
    try {
      // Limit filter JSON length for security
      const filterString = query.filters.substring(0, VALIDATION_RULES.MAX_FILTER_JSON_LENGTH);
      filters = JSON.parse(filterString);
      
      // Ensure filters is an object
      if (typeof filters !== 'object' || Array.isArray(filters)) {
        filters = {};
        filterError = 'Filters must be a valid JSON object';
      }
    } catch (error) {
      filters = {};
      filterError = 'Invalid JSON format in filters parameter';
    }
  }
  
  return {
    filters,
    hasFilters: Object.keys(filters).length > 0,
    filterError
  };
};

/**
 * Extract and validate include parameters for associations
 * @param {Object} query - Express request query object
 * @param {Array} availableAssociations - Available associations for the model
 * @returns {Object} Include parameters
 */
const getIncludeParams = (query = {}, availableAssociations = []) => {
  let include = [];
  let includeError = null;
  
  if (query.include) {
    const includeAssociations = query.include.split(',').map(assoc => assoc.trim());
    
    // Filter only valid associations
    include = includeAssociations.filter(assoc => {
      if (availableAssociations.includes(assoc)) {
        return true;
      } else {
        if (!includeError) {
          includeError = `Invalid association: ${assoc}`;
        }
        return false;
      }
    });
  }
  
  return {
    include,
    hasInclude: include.length > 0,
    includeError,
    requestedIncludes: query.include ? query.include.split(',').map(s => s.trim()) : []
  };
};

/**
 * Format paginated response data with metadata
 * @param {Object} queryResult - Sequelize findAndCountAll result
 * @param {number} page - Current page number
 * @param {number} limit - Records per page
 * @returns {Object} Formatted pagination response
 */
const formatPaginatedResponse = (queryResult, page, limit) => {
  const { count, rows } = queryResult;
  const totalPages = Math.ceil(count / limit);
  
  return {
    data: rows,
    totalCount: count,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    pagination: {
      totalItems: count,
      totalPages,
      currentPage: page,
      pageSize: limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      startIndex: (page - 1) * limit + 1,
      endIndex: Math.min(page * limit, count)
    }
  };
};

/**
 * Calculate pagination metadata without formatting full response
 * @param {number} count - Total record count
 * @param {number} page - Current page number
 * @param {number} limit - Records per page
 * @returns {Object} Pagination metadata
 */
const calculatePagination = (count, page, limit) => {
  const totalPages = Math.ceil(count / limit);
  
  return {
    totalItems: count,
    totalPages,
    currentPage: page,
    pageSize: limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    startIndex: (page - 1) * limit + 1,
    endIndex: Math.min(page * limit, count),
    isFirstPage: page === 1,
    isLastPage: page === totalPages
  };
};

/**
 * Build Sequelize where clause for search functionality
 * @param {string} search - Search term
 * @param {Array} searchableFields - Fields to search in
 * @param {Object} Sequelize - Sequelize instance for Op
 * @returns {Object} Sequelize where clause
 */
const buildSearchWhereClause = (search, searchableFields, Sequelize) => {
  if (!search || !searchableFields.length) {
    return {};
  }
  
  const { Op } = Sequelize;
  
  return {
    [Op.or]: searchableFields.map(field => ({
      [field]: {
        [Op.iLike]: `%${search}%`
      }
    }))
  };
};

/**
 * Build complete where clause combining search, filters, and additional conditions
 * @param {Object} params - Parameters object
 * @param {string} params.search - Search term
 * @param {Array} params.searchableFields - Fields to search in
 * @param {Object} params.filters - Additional filters
 * @param {Object} params.additionalWhere - Additional where conditions
 * @param {Object} Sequelize - Sequelize instance
 * @returns {Object} Complete where clause
 */
const buildWhereClause = (params, Sequelize) => {
  const { search, searchableFields = [], filters = {}, additionalWhere = {} } = params;
  const { Op } = Sequelize;
  
  let whereClause = { ...additionalWhere };
  
  // Add search conditions
  if (search && searchableFields.length > 0) {
    const searchWhere = buildSearchWhereClause(search, searchableFields, Sequelize);
    whereClause = { ...whereClause, ...searchWhere };
  }
  
  // Add custom filters
  if (Object.keys(filters).length > 0) {
    whereClause = { ...whereClause, ...filters };
  }
  
  return whereClause;
};

/**
 * Validate pagination parameters and return errors if any
 * @param {Object} query - Query parameters
 * @returns {Array} Array of validation errors
 */
const validatePaginationParams = (query) => {
  const errors = [];
  
  if (query.page !== undefined) {
    const page = parseInt(query.page);
    if (isNaN(page) || page < 1) {
      errors.push('Page must be a positive integer');
    }
  }
  
  if (query.size !== undefined || query.limit !== undefined) {
    const limit = parseInt(query.size || query.limit);
    if (isNaN(limit) || limit < ADMIN_ACCESS_CONFIG.MIN_PAGE_SIZE) {
      errors.push(`Page size must be at least ${ADMIN_ACCESS_CONFIG.MIN_PAGE_SIZE}`);
    }
    if (limit > ADMIN_ACCESS_CONFIG.MAX_PAGE_SIZE) {
      errors.push(`Page size cannot exceed ${ADMIN_ACCESS_CONFIG.MAX_PAGE_SIZE}`);
    }
  }
  
  if (query.sortOrder !== undefined) {
    const sortOrder = query.sortOrder.toUpperCase();
    if (!ADMIN_ACCESS_CONFIG.ALLOWED_SORT_ORDERS.map(o => o.toUpperCase()).includes(sortOrder)) {
      errors.push(`Sort order must be one of: ${ADMIN_ACCESS_CONFIG.ALLOWED_SORT_ORDERS.join(', ')}`);
    }
  }
  
  if (query.search !== undefined && query.search.length > ADMIN_ACCESS_CONFIG.MAX_SEARCH_LENGTH) {
    errors.push(`Search term cannot exceed ${ADMIN_ACCESS_CONFIG.MAX_SEARCH_LENGTH} characters`);
  }
  
  return errors;
};

/**
 * Generate pagination links for API responses
 * @param {Object} baseUrl - Base URL for pagination links
 * @param {Object} pagination - Pagination metadata
 * @param {Object} query - Original query parameters
 * @returns {Object} Pagination links
 */
const generatePaginationLinks = (baseUrl, pagination, query = {}) => {
  const links = {};
  const queryParams = { ...query };
  delete queryParams.page; // Remove page param to rebuild it
  
  const buildUrl = (page) => {
    const params = new URLSearchParams({ ...queryParams, page: page.toString() });
    return `${baseUrl}?${params.toString()}`;
  };
  
  // First page link
  if (pagination.currentPage > 1) {
    links.first = buildUrl(1);
  }
  
  // Previous page link
  if (pagination.hasPrevPage) {
    links.prev = buildUrl(pagination.currentPage - 1);
  }
  
  // Current page link
  links.self = buildUrl(pagination.currentPage);
  
  // Next page link
  if (pagination.hasNextPage) {
    links.next = buildUrl(pagination.currentPage + 1);
  }
  
  // Last page link
  if (pagination.currentPage < pagination.totalPages) {
    links.last = buildUrl(pagination.totalPages);
  }
  
  return links;
};

module.exports = {
  getPaginationParams,
  getSortingParams,
  getSearchParams,
  getFilterParams,
  getIncludeParams,
  formatPaginatedResponse,
  calculatePagination,
  buildSearchWhereClause,
  buildWhereClause,
  validatePaginationParams,
  generatePaginationLinks
};