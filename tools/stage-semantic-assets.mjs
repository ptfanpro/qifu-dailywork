import {pathToFileURL} from 'node:url';
import {stageSemanticAssets} from '../src/semantic-assets.mjs';

export function main(args){
  if(args.length!==3)throw Error('Expected: model-file head-file isolated-app-root');
  const [modelFile,headFile,targetAppRoot]=args;
  return stageSemanticAssets({modelFile,headFile,targetAppRoot});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(main(process.argv.slice(2)),null,2));}
  catch{console.error('Semantic asset staging failed; no release is authorized. Check the explicit local inputs and target snapshot.');process.exitCode=1;}
}
