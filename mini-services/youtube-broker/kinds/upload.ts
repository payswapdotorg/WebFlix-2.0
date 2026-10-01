/**
 * WFX2-P3-UP — the upload-execution kind module (THIS FILE IS THE P3-UP
 * LANE'S EXCLUSIVE TERRITORY; the shared registry — types.ts kinds array +
 * executor.ts routing — was pre-seeded by the lead on main so the lane
 * never edits a shared file).
 *
 * The staged drive (implemented below): navigate the logged-in tab to
 * https://www.youtube.com/upload, drive the file input, fill metadata,
 * advance the dialog (Next ×3), set visibility, publish — returning honest
 * intermediate states (uploading → processing → published) with the video
 * id + watch URL in `detail`.
 *
 * HOW THE DRIVE WORKS (the honest mechanics):
 *  - requiredUrl is NULL for this kind — the script owns its navigation.
 *    A single Runtime.evaluate cannot survive a cross-document navigation,
 *    so the FIRST invocation lands the tab on the upload page and returns
 *    the honest intermediate {detail:{stage:'navigating'}}; the app-side
 *    client (brokerUploadExecute) re-invokes, and from the second
 *    invocation on the script drives the whole dialog in ONE long
 *    evaluation (up to timeoutMs below).
 *  - the FILE BYTES ride the post-create image pattern: the payload's
 *    fileUrl (the app's staging route) is fetched in page context →
 *    blob → File(fileName) → DataTransfer → input.files → change event.
 *    The app stages the picked file before dispatch; the broker never
 *    carries bytes itself. No fileUrl → an honest 'file-source-missing'
 *    failure, never a fake upload.
 *  - every step reports its OWN honest failure (stage-accurate error +
 *    observed DOM state); the only {ok:true} shapes are a VERIFIED
 *    publish (share dialog / live dialog seen + video id read back) or
 *    an UNVERIFIED publish (publish clicked, id known, confirmation not
 *    observed within the deadline — honestly flagged via verified:false).
 *  - "made for kids" is not a payload field; when YouTube's Details step
 *    blocks Next on it, the drive selects "No" (the automation-neutral
 *    answer) — noted here so the behavior is documented, never silent.
 */

import type { BrokerPayload } from "../types";

const RUNNER = `const S=(ms)=>new Promise((r)=>setTimeout(r,ms));
const until=async(fn,ms=8000,step=250)=>{const t0=Date.now();for(;;){let v=null;try{v=fn()}catch(e){}if(v)return v;if(Date.now()-t0>ms)return null;await S(step)}};
const q=(sel,root)=>(root||document).querySelector(sel);
const qa=(sel,root)=>Array.from((root||document).querySelectorAll(sel));
const textOf=(el)=>el?(el.textContent||'').replace(/\\s+/g,' ').trim():'';
const norm=(s)=>(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
try{`;

const script = (body: string): string => `(async()=>{${RUNNER}${body}}catch(e){return{__exception:String(e)}}})()`;

const j = (value: unknown): string => JSON.stringify(value);

export interface UploadStagePayload {
  /** the local file name the flow presents in its progress UI + the File the drive attaches */
  fileName?: string;
  title?: string;
  description?: string;
  /** "public" | "unlisted" | "private" (default "public" per youtube.com) */
  visibility?: string;
  /**
   * The staged file's URL (the app's /upload/stage route) — the operator tab
   * fetches the real bytes from here and drives the real file input with
   * them. Required for an honest drive; a missing fileUrl fails honestly.
   */
  fileUrl?: string;
}

/** The drive's hard wall-clock ceiling (the work order's 300000 max). */
export const UPLOAD_EXECUTE_TIMEOUT_MS = 300000;

/** The script's internal deadline — margin under timeoutMs for serialization/latency. */
const SCRIPT_BUDGET_MS = 285000;

/**
 * Build the staged upload-drive page script.
 *
 * Payload (BrokerPayload + the UploadStagePayload fields the wire carries):
 *  - fileUrl (required) — the staged file URL the operator tab fetches
 *  - fileName — the File name attached to input[type=file] (default upload.mp4)
 *  - title (required) — YouTube refuses an untitled upload; the script fails
 *    honestly before navigating when it is missing
 *  - description (optional)
 *  - visibility — public | unlisted | private (default public)
 */
export function uploadExecuteScript(payload: BrokerPayload | undefined): {
  script: string;
  timeoutMs: number;
} {
  const p = (payload ?? {}) as BrokerPayload & UploadStagePayload;
  const fileName =
    typeof p.fileName === "string" && p.fileName.trim().length > 0
      ? p.fileName.trim().slice(0, 200)
      : "upload.mp4";
  const title = typeof p.title === "string" ? p.title.trim() : "";
  const description = typeof p.description === "string" ? p.description.slice(0, 5000) : "";
  const visibilityRaw = typeof p.visibility === "string" ? p.visibility.toLowerCase().trim() : "";
  const visibility =
    visibilityRaw === "unlisted" || visibilityRaw === "private" ? visibilityRaw : "public";
  const fileUrl =
    typeof p.fileUrl === "string" && /^https?:\/\//.test(p.fileUrl.trim()) ? p.fileUrl.trim() : "";

  const body = `
const UPLOAD_URL='https://www.youtube.com/upload';
const DOM=()=>({title:document.title,url:location.href});
const onUpload=()=>(location.hostname==='studio.youtube.com'&&/\\/upload\\/?$/.test(location.pathname))||(location.hostname==='www.youtube.com'&&location.pathname==='/upload');
const fileUrl=${j(fileUrl)};
const fileName=${j(fileName)};
const title=${j(title)};
const description=${j(description)};
const visibility=${j(visibility)};
if(!title) return {ok:false,error:'upload-execute: title-required — YouTube refuses an untitled upload',path:'ui',detail:{stage:'details'},dom:DOM()};
if(!fileUrl) return {ok:false,error:'upload-execute: file-source-missing — payload.fileUrl (the staged file the operator tab fetches) is required to drive the real file input',path:'ui',detail:{stage:'dialog'},dom:DOM()};
if(!onUpload()){
  location.href=UPLOAD_URL;
  return {ok:false,error:'upload-execute: navigating to the upload page — re-invoke to drive the dialog',path:'ui',detail:{stage:'navigating'}};
}
const T0=Date.now();
const BUDGET=${String(SCRIPT_BUDGET_MS)};
const LEFT=()=>BUDGET-(Date.now()-T0);
const within=async(fn,capMs)=>until(fn,Math.max(0,Math.min(capMs,LEFT())));
// stage 1 — the upload dialog's file input
let fileInput=await within(()=>q("input[type=file]"),25000);
if(!fileInput){
  const pick=await within(()=>q("#select-files-button, ytcp-uploader-file-dialog button, button[aria-label*='Select files' i]"),8000);
  if(pick){pick.click();await S(600);}
  fileInput=await within(()=>q("input[type=file]"),15000);
}
if(!fileInput) return {ok:false,error:'upload-execute: file-input-not-found — the upload dialog did not open (is the operator signed in with upload rights?)',path:'ui',detail:{stage:'dialog'},dom:DOM()};
// the staged bytes → a real File → the real input (the post-create image pattern, video-scaled)
let blob=null;
try{
  const res=await fetch(fileUrl,{mode:'cors'});
  if(!res.ok) return {ok:false,error:'upload-execute: staged-file-fetch-failed',path:'ui',detail:{stage:'dialog',status:res.status},dom:DOM()};
  blob=await res.blob();
}catch(e){
  return {ok:false,error:'upload-execute: staged-file-unreachable',path:'ui',detail:{stage:'dialog',message:String((e&&e.message)||e)},dom:DOM()};
}
if(!blob||blob.size===0) return {ok:false,error:'upload-execute: staged-file-empty',path:'ui',detail:{stage:'dialog'},dom:DOM()};
const mime=(blob.type&&/^video\\//.test(blob.type))?blob.type:'video/mp4';
const file=new File([blob],fileName,{type:mime});
const dt=new DataTransfer();
dt.items.add(file);
fileInput.files=dt.files;
fileInput.dispatchEvent(new Event('change',{bubbles:true}));
// stage 2 — the Details step (title required, description optional)
const fillText=async(el,text)=>{
  if(!el) return false;
  try{el.scrollIntoView({block:'center'});}catch(e){}
  el.focus();
  if(el.isContentEditable){
    document.execCommand('selectAll',false,null);
    document.execCommand('insertText',false,text);
  }else{
    el.value=text;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  await S(300);
  const now=el.value!==undefined?String(el.value):textOf(el);
  return text.length===0?true:(now.indexOf(text.slice(0,Math.min(20,text.length)))>-1);
};
const titleBox=await within(()=>{
  const scoped=qa("ytcp-video-title #textbox, #video-title, [aria-label*='title' i][contenteditable], textarea[aria-label*='title' i]");
  const found=scoped.find(el=>el.isConnected);
  if(found) return found;
  const boxes=qa("#textbox");
  return boxes.length?boxes[0]:null;
},40000);
if(!titleBox) return {ok:false,error:'upload-execute: details-step-not-reached — the title field never appeared (the file may have been rejected)',path:'ui',detail:{stage:'details'},dom:DOM()};
const titleOk=await fillText(titleBox,title);
if(!titleOk) return {ok:false,error:'upload-execute: title-not-filled — the Details title field did not accept the text',path:'ui',detail:{stage:'details'},dom:DOM()};
if(description){
  const descTrigger=q("#description-trigger, ytcp-video-description #trigger");
  if(descTrigger){descTrigger.click();await S(400);}
  const descBox=await within(()=>{
    const scoped=qa("ytcp-video-description #textbox, #description #textbox, [aria-label*='description' i][contenteditable], textarea[aria-label*='description' i]");
    return scoped.find(el=>el.isConnected&&el!==titleBox)||null;
  },10000);
  if(descBox){await fillText(descBox,description);}
}
// "made for kids" is not a payload field — select "No" only when the radio
// group exists and blocks the flow (documented in the module doc comment)
const kidsNo=q("tp-yt-paper-radio-button[name='VIDEO_MADE_FOR_KIDS_NOT_MFK'], input[name='VIDEO_MADE_FOR_KIDS_NOT_MFK'], [role=radio][aria-label*='not made for kids' i]");
if(kidsNo){
  const checked=kidsNo.checked===true||kidsNo.getAttribute('aria-checked')==='true'||!!q('input:checked',kidsNo);
  if(!checked){kidsNo.click();await S(400);}
}
// stage 3 — Next ×3 (Details → Video elements → Checks → Visibility)
for(let step=1;step<=3;step++){
  const btn=await within(()=>{
    const b=q("#next-button");
    if(!b) return null;
    if(b.disabled===true||b.getAttribute('aria-disabled')==='true') return null;
    return b;
  },120000);
  if(!btn) return {ok:false,error:'upload-execute: next-button-not-ready at step '+step+'/3 (checks may still be running or the step was blocked)',path:'ui',detail:{stage:'checks',step:step},dom:DOM()};
  btn.click();
  await S(800);
}
// stage 4 — visibility (public | unlisted | private; public is the YouTube default)
const findVis=()=>{
  const cands=qa("[role=radio], tp-yt-paper-radio-button, input[type=radio], label");
  return cands.find(el=>{
    const t=textOf(el)||el.getAttribute('aria-label')||'';
    return t&&norm(t)===norm(visibility);
  })||null;
};
const visEl=await within(findVis,15000);
if(visEl){
  (visEl.closest("tp-yt-paper-radio-button, [role=radio], label")||visEl).click();
  await S(600);
}else if(visibility!=='public'){
  return {ok:false,error:'upload-execute: visibility-option-not-found: '+visibility,path:'ui',detail:{stage:'visibility',wanted:visibility},dom:Object.assign(DOM(),{options:qa("[role=radio], tp-yt-paper-radio-button").map(textOf).filter(Boolean).slice(0,8)})};
}
// stage 5 — publish (the long wait: the button gates on upload completion)
const videoIdNow=()=>{
  const hrefs=qa("a[href]").map(a=>a.getAttribute('href')||'').join(' ');
  const m=hrefs.match(/(?:youtu\\.be\\/|watch\\?v=|shorts\\/)([A-Za-z0-9_-]{11})/);
  if(m) return m[1];
  const t=((document.body&&document.body.textContent)||'').match(/youtu\\.be\\/([A-Za-z0-9_-]{11})/);
  return t?t[1]:null;
};
const pubBtn=await within(()=>{
  const b=q("#publish-button, #done-button");
  if(!b) return null;
  if(b.disabled===true||b.getAttribute('aria-disabled')==='true') return null;
  return b;
},LEFT());
if(!pubBtn){
  const vidEarly=videoIdNow();
  return {ok:false,error:'upload-execute: publish-button-not-ready — the upload was still in progress when the deadline hit (or publishing was blocked)',path:'ui',detail:Object.assign({stage:vidEarly?'uploading':'checks'},vidEarly?{videoId:vidEarly,watchUrl:'https://www.youtube.com/watch?v='+vidEarly}:{}),dom:DOM()};
}
pubBtn.click();
// stage 6 — the honest result: verified publish, unverified publish, or failure
const vid1=videoIdNow();
const confirmEv=await within(()=>{
  if(q("ytcp-video-share-dialog, #video-is-live-dialog, ytcp-uploads-still-processing-dialog")) return true;
  if(!q("ytcp-uploads-dialog")&&videoIdNow()) return true;
  return null;
},Math.min(90000,LEFT()));
const vid=videoIdNow()||vid1;
if(vid){
  const watchUrl='https://www.youtube.com/watch?v='+vid;
  if(confirmEv) return {ok:true,verified:true,path:'ui',detail:{stage:'published',videoId:vid,watchUrl:watchUrl}};
  return {ok:true,verified:false,path:'ui',detail:{stage:'processing',videoId:vid,watchUrl:watchUrl},note:'publish clicked — the confirmation was not observed within the deadline; the video may still be processing'};
}
return {ok:false,verified:false,error:'upload-execute: publish-confirmation-not-observed (no video id was found)',path:'ui',detail:{stage:'publishing'},dom:DOM()};
`;

  return {
    script: script(body),
    timeoutMs: UPLOAD_EXECUTE_TIMEOUT_MS,
  };
}
