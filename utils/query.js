// utils/query.js
function parseMaybeJSON(val) {
    if (val == null) return undefined;
    if (typeof val !== 'string') return undefined;
    try { return JSON.parse(val); } catch { return '__INVALID_JSON__'; }
  }
  
  export function buildQueryParams(modelName, query) {
    const where = parseMaybeJSON(query.where);
    const sort = parseMaybeJSON(query.sort);
    const select = parseMaybeJSON(query.select);
    const skip = query.skip != null ? parseInt(query.skip, 10) : undefined;
    let limit = query.limit != null ? parseInt(query.limit, 10) : undefined;
    const count = query.count === 'true' || query.count === true;
  
    if (modelName === 'Task' && (limit == null || Number.isNaN(limit))) limit = 100;
  
    const invalid =
      where === '__INVALID_JSON__' ||
      sort === '__INVALID_JSON__' ||
      select === '__INVALID_JSON__';
  
    return { where, sort, select, skip, limit, count, invalid };
  }
  