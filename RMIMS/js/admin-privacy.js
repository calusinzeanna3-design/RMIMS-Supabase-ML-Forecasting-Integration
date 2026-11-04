/**
 * Admin privacy: the Main Admin sees THAT an operation happened (who, where, when) but never the
 * confidential operational figures of each store, i.e. what material and how much was received or
 * disbursed.  "Receive Raw Material: +260 g Fresh Yellow Squash"  ->  "Receive Raw Material: +*** of Fr*** Ye*** Sq***"
 */
const OP_VERB = /(receiv|disburs|stock|material|withdraw|issu|transaction|approv|reject|return|inventory)/i;

function maskWord(w) {
  const core = String(w).replace(/[^A-Za-z0-9]/g, '');
  if (!core) return w;
  const keep = core.slice(0, 2);
  return keep + '*'.repeat(Math.max(3, core.length - 2));
}

export function maskName(name) {
  return String(name || '')
    .split(/(\s+|[()/,&-]+)/)
    .map(part => (/^[\s()/,&-]*$/.test(part) ? part : maskWord(part)))
    .join('');
}

/** Mask quantity + material name inside an activity description. */
export function maskOperationalDetails(text) {
  const t = String(text == null ? '' : text);
  if (!OP_VERB.test(t)) return t;

  // "Received 260 g of Fresh Yellow Squash from ABC Supplier."  /  "Disbursed 50 g of Margarine for Muffins."
  const sent = t.match(/^(\s*(?:Received|Disbursed|Issued|Withdrew|Added|Deducted)\s+)[\d.,]+\s*[A-Za-z]{0,8}\s+of\s+(.+?)(?:\s+(from|for)\s+.+?)?(\.?)$/i);
  if (sent) {
    return `${sent[1]}*** of ${maskName(sent[2])}${sent[3] ? ` ${sent[3]} ***` : ''}${sent[4] || ''}`;
  }

  // "<Action>: +260 g Fresh Yellow Squash (Kalabasa) (for Nutribun)"
  let m = t.match(/^(.*?:\s*)([+-])\s*[\d.,]+\s*(?:[A-Za-z]{1,8}\b)?\s+(.+?)((?:\s*\((?:for|used|reason)[^)]*\))?)$/i);
  if (m) {
    return `${m[1]}${m[2]}*** of ${maskName(m[3])}${m[4] ? ' (confidential)' : ''}`;
  }

  // "Received 3 raw material(s)" / counts stay; any signed numeric quantity gets hidden
  let out = t.replace(/(?<=[:\s])([+-])\s*[\d.,]+\s*(?:kg|g|mg|l|ml|pcs|pc|packs?|pieces|tubers|liters?)?\b/gi, '$1***');
  // "from <Supplier>" is confidential too
  out = out.replace(/\bfrom\s+[^.()]+/i, 'from ***');
  return out;
}

if (typeof window !== 'undefined') window.maskOperationalDetails = maskOperationalDetails;
