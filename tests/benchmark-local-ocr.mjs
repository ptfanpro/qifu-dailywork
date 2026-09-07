// Deterministic local inference microbenchmark, not a recognition accuracy test.
import {createRequire} from 'node:module';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
const require=createRequire(import.meta.url),ort=require(path.resolve('vendor/onnxruntime-node'));
const input=new Float32Array(3*48*320);
for(let i=0;i<input.length;i++) input[i]=((i*31)%255)/127.5-1;
const tensor=new ort.Tensor('float32',input,[1,3,48,320]);
for(const threads of [null,1,2,4]) {
  const session=await ort.InferenceSession.create(path.resolve('models/paddleocr-en-v5/inference.onnx'),{
    executionProviders:['cpu'],graphOptimizationLevel:'all',logSeverityLevel:3,
    ...(threads?{intraOpNumThreads:threads,interOpNumThreads:1}:{}),
  });
  await session.run({[session.inputNames[0]]:tensor});
  const started=performance.now();
  for(let i=0;i<30;i++) await session.run({[session.inputNames[0]]:tensor});
  console.log(JSON.stringify({threads:threads||'default',count:30,msPerInference:Math.round((performance.now()-started)/30*100)/100}));
  await session.release();
}
