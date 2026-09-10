// Complete printed-code observations, before PDF/range/confidence filtering.
// Shared by fixed-window, detected-line and independent Windows collectors.
export function parseCompletePrintedCodes(rawText,expectedPrefix) {
  const prefix=String(expectedPrefix||'');
  const text=String(rawText||'').replace(/[—–_]/g,'-').replace(/[Oo]/g,'0')
    .replace(/[Il|]/g,'1').replace(/\s+/g,' ').trim()
    .replace(/[·•﹣－−]/g,'-').replace(/\s*-\s*/g,'-');
  const matches=[...text.matchAll(/(?<![\d-])(\d{3,4})-1-(\d{1,4})(?![\d-])/g)];
  const codes=[],seen=new Set();
  let incompleteTailObserved=false;
  for(const match of matches) {
    const after=text.slice(match.index+match[0].length);
    if(/^\s+\d/.test(after)&&!/^\s+\d{3,4}-1-\d/.test(after)) {
      incompleteTailObserved=true;
      continue;
    }
    if(Number(match[2])>0&&!seen.has(match[0])) {
      seen.add(match[0]);
      codes.push({prefix:match[1],number:Number(match[2]),fullCode:match[0]});
    }
  }
  const numbers=[...new Set(codes.filter(code=>code.prefix===prefix).map(code=>code.number))];
  return {numbers,codes,incompleteTailObserved};
}
