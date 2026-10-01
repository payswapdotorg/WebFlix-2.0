/**
 * WFX2-P3-LC — the live-chat-send kind module (THIS FILE IS THE P3-LC
 * LANE'S EXCLUSIVE TERRITORY; the shared registry — types.ts kinds array +
 * executor.ts routing — was pre-seeded by the lead on main so the lane
 * never edits a shared file).
 *
 * The send: with the tab on the live watch URL (requiredUrl already routes
 * it there), expand the chat when the watch page renders it collapsed, read
 * the chat's own honest states, type the message into the REAL live-chat
 * composer (yt-live-chat-text-input-field-renderer #input — the comment
 * composer's focus → selectAll → insertText pattern), press Enter (the
 * composer's own submit binding; the send-button click is the
 * belt-and-braces fallback), then verify the message appears in the chat
 * stream (the latest N authored rows, yt-live-chat-text-message-renderer).
 *
 * Honest errors — each {ok:false, error, path:'ui', dom} per the
 * established executor pattern (never an invented success):
 *   chat-members-only            youtube.com's "Chat is available to members
 *                                only" state (the notice replaces the
 *                                usable composer)
 *   chat-slow-mode               slow mode — the send control is held off
 *                                with the countdown notice ("You can send
 *                                messages again in N seconds")
 *   chat-disabled                "Chat is disabled for this live stream."
 *   live-chat-composer-not-found no live-chat composer on this page (not a
 *                                live stream, or chat lives in the popout)
 *   live-chat-send-button-not-found
 *   live-chat-typing-failed      the composer did not accept the text
 *   live-chat-send-failed        Enter AND the send-button click left the
 *                                text in the composer (the send did not
 *                                fire, and no platform state explains it)
 */

const RUNNER = `const R=(s)=>s&&(s.__exception?{__exception:s.__exception}:s);
try{`;

const script = (body: string): string => `(async()=>{${RUNNER}${body}}catch(e){return{__exception:String(e)}}})()`;

const j = (value: unknown): string => JSON.stringify(value);

/**
 * Build the live-chat-send page script (evaluated in the logged-in tab,
 * awaitPromise — the established kind-module contract).
 */
export function liveChatSendScript(message: string): {
  script: string;
  timeoutMs: number;
} {
  const needle = message.slice(0, 40);
  return {
    script: script(`
const S=(ms)=>new Promise((r)=>setTimeout(r,ms));
const until=async(fn,ms=8000,step=250)=>{const t0=Date.now();for(;;){let v=null;try{v=fn()}catch(e){}if(v)return v;if(Date.now()-t0>ms)return null;await S(step)}};
const q=(sel,root)=>(root||document).querySelector(sel);
const qa=(sel,root)=>Array.from((root||document).querySelectorAll(sel));
const textOf=(el)=>el?(el.textContent||'').replace(/\\s+/g,' ').trim():'';
const domState=()=>({title:document.title,url:location.href});
const chatRoot=()=>q("yt-live-chat-renderer")||q("ytd-live-chat-frame-renderer");
// youtube.com renders its chat-state notices in alert renderers and the
// NON-text message renderer — authored rows are yt-live-chat-TEXT-message-
// renderer, so this scan never false-positives on chat messages themselves.
const noticeText=()=>qa("yt-live-chat-renderer yt-alert-renderer, ytd-live-chat-frame-renderer yt-alert-renderer, yt-live-chat-message-renderer").map(textOf).filter(Boolean).join(' | ');
const MEMBERS=/chat is available to members only|members[- ]only chat/i;
const LOCKED=/chat is disabled|chat has been turned off|chat is locked/i;
const SLOW=/(send|sending|post|chat|message)[^.]{0,40}again in|slow mode|too quickly/i;
const INPUT_SEL="yt-live-chat-text-input-field-renderer #input, yt-live-chat-text-input-field-renderer div#input[contenteditable]";
const SEND_SEL="#send-button button, yt-live-chat-send-button-renderer button, ytd-live-chat-input-panel-renderer #send-button button";
const message=${j(message)};
let input=await until(()=>q(INPUT_SEL),8000);
if(!input){
  // the watch page renders the chat collapsed — expand it, then retry
  const toggle=q("ytd-live-chat-frame-renderer #show-hide-button button, yt-live-chat-renderer #show-hide-button button, #show-hide-button button");
  if(toggle){toggle.click();await S(600);}
  input=await until(()=>q(INPUT_SEL),8000);
}
if(!input){
  const notice=noticeText();
  if(MEMBERS.test(notice)) return R({ok:false,error:'chat-members-only',path:'ui',dom:{...domState(),notice:notice.slice(0,200)}});
  if(LOCKED.test(notice)) return R({ok:false,error:'chat-disabled',path:'ui',dom:{...domState(),notice:notice.slice(0,200)}});
  return R({ok:false,error:'live-chat-composer-not-found',path:'ui',dom:{...domState(),chat:!!chatRoot(),note:'no live-chat composer on this page (not a live stream, or the chat lives in the popout)'}});
}
const sendBtn=q(SEND_SEL);
if(!sendBtn) return R({ok:false,error:'live-chat-send-button-not-found',path:'ui',dom:{...domState(),inputText:textOf(input).slice(0,80)}});
const isDisabled=(b)=>b.hasAttribute('disabled')||b.getAttribute('aria-disabled')==='true';
// slow-mode pre-check: the send control is held off with a countdown notice
if(isDisabled(sendBtn)){
  const tip=qa("yt-live-chat-text-input-field-renderer tp-yt-paper-tooltip, #send-button tp-yt-paper-tooltip, yt-live-chat-text-input-field-renderer #label").map(textOf).join(' | ');
  const notice=noticeText();
  if(SLOW.test(tip)||SLOW.test(notice)) return R({ok:false,error:'chat-slow-mode',path:'ui',dom:{...domState(),notice:(tip+' '+notice).slice(0,200)}});
}
// type into the real composer (the comment-composer pattern)
input.focus();
document.execCommand('selectAll',false,null);
document.execCommand('insertText',false,message);
await S(250);
const typed=textOf(input);
if(!typed.includes(${j(needle)})) return R({ok:false,error:'live-chat-typing-failed',path:'ui',dom:{...domState(),inputText:typed.slice(0,80)}});
// press Enter (the composer's own submit binding)
input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
input.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
await S(500);
// belt-and-braces: the send-button click when the composer still holds the text
if(textOf(input)){ if(!isDisabled(sendBtn)) sendBtn.click(); await S(500); }
// the composer still holds the text → the send did not fire; classify honestly
if(textOf(input)){
  const after=noticeText();
  if(SLOW.test(after)) return R({ok:false,error:'chat-slow-mode',path:'ui',dom:{...domState(),notice:after.slice(0,200)}});
  if(MEMBERS.test(after)) return R({ok:false,error:'chat-members-only',path:'ui',dom:{...domState(),notice:after.slice(0,200)}});
  if(LOCKED.test(after)) return R({ok:false,error:'chat-disabled',path:'ui',dom:{...domState(),notice:after.slice(0,200)}});
  return R({ok:false,error:'live-chat-send-failed',path:'ui',dom:{...domState(),inputText:textOf(input).slice(0,80),sendDisabled:isDisabled(sendBtn)}});
}
// the composer cleared → verify the message appears in the chat stream
// (the latest N authored rows; render lag is real, so wait it out)
const needle=${j(needle)};
const mine=await until(()=>{
  const rows=qa("yt-live-chat-text-message-renderer");
  return rows.slice(-40).find(el=>textOf(el.querySelector("#message")).includes(needle))||null;
},12000);
if(mine){
  const messageId=(typeof mine.id==='string'&&mine.id)?mine.id:null;
  return R({ok:true,verified:true,path:'ui',detail:{messageId,author:textOf(mine.querySelector("#author-name"))||null}});
}
return R({ok:true,verified:false,path:'ui',detail:{note:'composer cleared after send; the message is not yet visible in the chat stream (render lag)'}});
`),
    timeoutMs: 45000,
  };
}
