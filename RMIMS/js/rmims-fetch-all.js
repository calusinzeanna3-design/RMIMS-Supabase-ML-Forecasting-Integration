// Reads EVERY row of a Supabase query, not only the first 1,000.
// Supabase returns at most 1,000 rows per request, so this asks page by page
// (rows 0-999, 1000-1999, ...) until a page comes back with fewer rows.
// Returns the same shape as a normal query: { data, error, count, status }.
// If any page fails, the error is returned (nothing partial is shown as complete).
export const RMIMS_PAGE_SIZE = 1000;

export async function allRows(query, pageSize = RMIMS_PAGE_SIZE) {
  if (!query || typeof query.range !== 'function') return query;
  // a stable last sort key so no row is skipped or repeated between pages
  try { if (typeof query.order === 'function') query.order('id', { ascending: true }); } catch (_) {}
  const rows = [];
  for (let from = 0, pages = 0; pages < 1000; from += pageSize, pages++) {
    const res = await query.range(from, from + pageSize - 1);
    if (!res || res.error) return res || { data: null, error: new Error('No response') };
    const page = Array.isArray(res.data) ? res.data : [];
    rows.push(...page);
    if (page.length < pageSize) return { ...res, data: rows, count: rows.length };
  }
  return { data: rows, error: null, count: rows.length };
}
