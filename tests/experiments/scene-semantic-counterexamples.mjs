// Historical-failure safety gate, not a passing recognition benchmark.
// Anonymous global metrics from independently reviewed whole-image examples.
// No photos, paths, hashes, dates, expected page numbers or customer text.
// Run explicitly before release: nonzero means these old shortcuts remain unsafe.
// Safe abstention is allowed; it does not count as correct automatic recognition.
import {pathToFileURL} from 'node:url';
import {isLikelyScene,classifySceneVisualScore,diagnoseLegacySceneMetrics} from '../../src/photo-prepare.mjs';

export const counterexamples = [
  {
    id: 'foreground-sheet-with-background-color-merge', role: 'paper',
    paperGeometry: {left:0,top:0.17916666666666667,width:1,height:0.8208333333333333,
      right:1,bottom:1,score:0.2740755208333333,fill:0.3338991116751269,
      boxArea:0.8208333333333333,rectangularPaper:false,usablePaper:false},
    visualMetrics: {edgeDensity:0.08255208333333333,upperEdgeDensity:0.03790364583333333,uniformity:0.5512109375},
    sceneMetrics: {luminance:131.93946189583363,warmBrightRatio:0.18239583333333334,darkRatio:0.10078125,
      flameStructure:{count:120,columns:5,rows:6,spanX:0.9933593749999999,spanY:0.6402777777777778,distributed:true}},
  },
  {
    id: 'water-bowls-under-shadow-a', role: 'water',
    paperGeometry: {left:0.3,top:0.45,width:0.65,height:0.55,right:0.95,bottom:1,
      score:0.0929296875,fill:0.2599431818181818,boxArea:0.3575,rectangularPaper:false,usablePaper:false},
    visualMetrics: {edgeDensity:0.10798177083333334,upperEdgeDensity:0.07088541666666667,uniformity:0.5214453125},
    sceneMetrics: {luminance:87.79695030208423,warmBrightRatio:0.07817708333333333,darkRatio:0.39208333333333334,
      flameStructure:{count:110,columns:5,rows:5,spanX:0.9415178571428572,spanY:0.6116666666666667,distributed:true}},
  },
  {
    id: 'water-bowls-under-shadow-b', role: 'water',
    paperGeometry: {left:0.334375,top:0.1125,width:0.65,height:0.8541666666666666,right:0.984375,bottom:0.9666666666666667,
      score:0.14583333333333334,fill:0.2626641651031895,boxArea:0.5552083333333333,rectangularPaper:false,usablePaper:false},
    visualMetrics: {edgeDensity:0.12893229166666667,upperEdgeDensity:0.08454427083333334,uniformity:0.4931510416666667},
    sceneMetrics: {luminance:91.75960196875018,warmBrightRatio:0.10130208333333333,darkRatio:0.40432291666666664,
      flameStructure:{count:101,columns:5,rows:6,spanX:0.890625,spanY:0.6458333333333334,distributed:true}},
  },
];

export function evaluateCounterexamples() {
  const rows=counterexamples.map(item=>{
    const likelyScene=isLikelyScene(item);
    const category=likelyScene?classifySceneVisualScore(item.sceneMetrics):null;
    const legacy=diagnoseLegacySceneMetrics(item);
    return {id:item.id,likelyScene,category,legacyDiagnostic:legacy,
      legacyUnsafeHint:item.role==='paper'?legacy.likelyScene:legacy.category==='scene-lamp',
      unsafeHeuristicDecision:item.role==='paper'?likelyScene:category==='scene-lamp'};
  });
  return {status:'heuristic-safety-counterexamples-not-order-binding',
    cases:rows.length,failures:rows.filter(row=>row.unsafeHeuristicDecision).length,rows,
    legacyUnsafeHints:rows.filter(row=>row.legacyUnsafeHint).length,
    note:'Global metrics are not independent semantic proof. Zero failures would establish only safe handling of these counterexamples, not restored recognition or release acceptance.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const report=evaluateCounterexamples();
  console.log(JSON.stringify(report,null,2));
  process.exitCode=report.failures?1:0;
}
