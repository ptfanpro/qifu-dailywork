import crypto from 'node:crypto';

export const HISTORICAL_RANGE_START='2000-01-01';

function validDateToken(value) {
  const match=String(value||'').match(/(\d{4})[-年\/](\d{1,2})[-月\/](\d{1,2})/);
  if(!match)return null;
  const token=`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
  const parsed=new Date(`${token}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===token?token:null;
}

function hashIds(rows) {
  const ids=rows.map(row=>String(row?.id||'')).filter(Boolean).sort();
  return crypto.createHash('sha256').update(ids.join('\n')).digest('hex');
}

export function beijingDateToken(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const values=Object.fromEntries(parts.map(({type,value})=>[type,value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildHistoricalBacklogReport({
  asOfDate,
  pendingRegular=[],
  pendingTablet=[],
  prayingWithoutPhotoRegular=[],
  prayingWithoutPhotoTablet=[],
}={}) {
  const today=validDateToken(asOfDate);
  if(!today)throw new Error('历史线上检查缺少有效的北京时间今天日期。');
  const categories={pendingRegular,pendingTablet,prayingWithoutPhotoRegular,prayingWithoutPhotoTablet};
  const all=[];
  const seen=new Set();
  for(const [category,rows] of Object.entries(categories)) {
    if(!Array.isArray(rows))throw new Error(`历史线上检查结果格式错误：${category}`);
    for(const row of rows) {
      const id=String(row?.id||'');
      if(!id)throw new Error('历史线上检查结果缺少订单 ID。');
      if(seen.has(id))throw new Error('历史线上检查结果出现重复订单，不能生成不准确的待办数量。');
      seen.add(id);
      const businessDate=validDateToken(row?.prayerDate);
      if(businessDate&&businessDate>=today)throw new Error('历史线上检查结果混入今天或未来业务，日期范围保护已停止本次结果。');
      all.push({id,businessDate,category});
    }
  }
  const pendingPrayerCount=pendingRegular.length+pendingTablet.length;
  const prayingWithoutPhotoCount=prayingWithoutPhotoRegular.length+prayingWithoutPhotoTablet.length;
  const businessDates=[...new Set(all.map(item=>item.businessDate).filter(Boolean))].sort();
  return {
    schemaVersion:1,
    checkedAt:new Date().toISOString(),
    readOnly:true,
    platformModified:false,
    range:{start:HISTORICAL_RANGE_START,endExclusive:today,todayExcluded:true},
    complete:all.length===0,
    totalCount:all.length,
    pendingPrayerCount,
    prayingWithoutPhotoCount,
    counts:{
      pendingRegular:pendingRegular.length,
      pendingTablet:pendingTablet.length,
      prayingWithoutPhotoRegular:prayingWithoutPhotoRegular.length,
      prayingWithoutPhotoTablet:prayingWithoutPhotoTablet.length,
    },
    businessDates,
    orderIdHashes:Object.fromEntries(Object.entries(categories).map(([name,rows])=>[name,hashIds(rows)])),
  };
}
