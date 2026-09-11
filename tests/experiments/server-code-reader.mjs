// The rejected global-replacement experiment shares the pinned line reader
// with the bounded production prefix path; its literal lexer remains diagnostic.
export {SERVER_CODE_MODEL_SHA256,SERVER_CODE_RECIPE,verifyServerCodeModel,serverCodeImageValues,createServerCodeReader} from '../../src/server-code-reader.mjs';
// Additional raw-lexeme measurement, not a replacement for the product parser.
// Separators may be glyph variants; letters are never silently converted to digits.
// Lines remain separate so the end of one line cannot complete another line's code.
export function literalCodeObservations(rawText) {
  const codes=new Set();let splitTailObserved=false;
  for(const line of String(rawText||'').split(/[\r\n\v\f\u0085\u2028\u2029]+/)) {
    const normalized=line.replace(/[—–_·•﹣－−]/g,'-').replace(/[^\S\r\n]*-[^\S\r\n]*/g,'-');
    for(const match of normalized.matchAll(/(?<![\p{L}\p{N}-])(\d{3,4})-1-(\d{1,4})(?![\p{L}\p{N}-])/gu)) {
      const after=normalized.slice(match.index+match[0].length);
      if(/^\s+\d/.test(after)&&!/^\s+\d{3,4}-1-\d/.test(after)){splitTailObserved=true;continue;}
      if(Number(match[2])>0)codes.add(match[0]);
    }
  }
  return {codes:[...codes],splitTailObserved};
}
