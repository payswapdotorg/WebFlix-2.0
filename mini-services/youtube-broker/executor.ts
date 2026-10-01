/**
 * WFX2-A-W Session Broker — the action executor.
 *
 * Executes an action in the logged-in YouTube tab over CDP.
 *
 * PREFERRED path ("ui"): simulate the REAL UI interaction (click the like
 * button / subscribe button / comment box) via DOM clicks — 100% fidelity,
 * it IS what a user does on youtube.com (verification log §19: broker like
 * works with 100% fidelity via page-context click).
 *
 * FALLBACK path ("fetch"): page-context `fetch('/youtubei/v1/…', {method:
 * 'POST', credentials:'include'})` from the page's own JS context — the
 * page's own request pipeline carries the fresh `_u` attestation, and
 * `window.ytcfg.get('INNERTUBE_CONTEXT')` supplies the real client context.
 * The like params protobuf is videoId-templatable (verification log §20,
 * byte-level swap verified) — the templates below are decoded from
 * tests/fixtures/yt/request_payload_examples.json.
 */
import { CdpConnection } from "./cdp";
import type { BrokerActionKind, BrokerActionRequest, BrokerActionResponse } from "./types";
// WFX2-P3 — lane-owned kind modules (the registry routing is pre-seeded here;
// the bodies live in kinds/ and never require shared-file edits)
import { uploadExecuteScript } from "./kinds/upload";
import { liveChatSendScript } from "./kinds/livechat";

/* ------------------------------------------------------------------ */
/* like params protobuf templates (fixture: request_payload_examples)  */
/* ------------------------------------------------------------------ */

// like/like: 0a 0d 0a 0b <11-char id> 20 00 32 0c 08 <ts varint> 10 <hash>
const LIKE_TPL = Buffer.from("Cg0KC2RRdzR3OVdnWGNRIAAyDAiH6OzVBhCG4ZOCAg==", "base64");
// like/removelike: 0a 0d 0a 0b <11-char id> 18 00 2a 0c 08 <ts varint> 10 <hash>
const REMOVELIKE_TPL = Buffer.from("Cg0KC2RRdzR3OVdnWGNRGAAqDAiH6OzVBhCurJSCAg==", "base64");

/**
 * VideoId-templated like/removelike params (base64, URL-encoded padding —
 * the exact wire form youtube.com sends). Refreshes the timestamp field.
 * Returns null when the videoId isn't the standard 11 chars (template can't
 * be byte-swapped).
 */
export function buildLikeParams(videoId: string, remove: boolean): string | null {
  if (videoId.length !== 11) return null;
  const buf = Buffer.from(remove ? REMOVELIKE_TPL : LIKE_TPL);
  buf.write(videoId, 4, "latin1");
  const ts = Math.floor(Date.now() / 1000);
  buf[20] = (ts & 0x7f) | 0x80;
  buf[21] = ((ts >>> 7) & 0x7f) | 0x80;
  buf[22] = ((ts >>> 14) & 0x7f) | 0x80;
  buf[23] = ((ts >>> 21) & 0x7f) | 0x80;
  buf[24] = (ts >>> 28) & 0x7f;
  return buf.toString("base64").replace(/=/g, "%3D");
}

/* ------------------------------------------------------------------ */
/* page-script scaffolding                                             */
/* ------------------------------------------------------------------ */

/** Utilities injected into every page-context script. */
const RUNNER = `
const S=(ms)=>new Promise((r)=>setTimeout(r,ms));
const until=async(fn,ms=8000,step=250)=>{const t0=Date.now();for(;;){let v=null;try{v=fn()}catch(e){}if(v)return v;if(Date.now()-t0>ms)return null;await S(step)}};
const q=(sel,root)=>(root||document).querySelector(sel);
const qa=(sel,root)=>Array.from((root||document).querySelectorAll(sel));
const textOf=(el)=>el?(el.textContent||'').replace(/\\s+/g,' ').trim():'';
const pressed=(b)=>!!b&&b.getAttribute('aria-pressed')==='true';
const norm=(s)=>(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const CTX=()=>{try{if(window.ytcfg&&typeof window.ytcfg.get==='function'){const c=window.ytcfg.get('INNERTUBE_CONTEXT');if(c&&c.client)return c;}}catch(e){}return {client:{clientName:'WEB',clientVersion:'2.20250101.01.00'}}};
const post=(path,body)=>fetch('/youtubei/v1/'+path+'?prettyPrint=false',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(async(r)=>({status:r.status,ok:r.ok,text:(await r.text().catch(()=>'')).slice(0,300)}));
`;

/** Wrap a body into an awaitPromise-able async IIFE expression. */
function script(body: string): string {
  return `(async()=>{${RUNNER}${body}})()`;
}

function j(value: unknown): string {
  return JSON.stringify(value);
}

const domState = () => `({title:document.title,url:location.href})`;

/* ------------------------------------------------------------------ */
/* per-kind page scripts                                               */
/* ------------------------------------------------------------------ */

const LIKE_SEL =
  "'like-button-view-model button, ytd-toggle-button-renderer like-button button, ytd-segmented-like-dislike-button-renderer like-button button'";
const DISLIKE_SEL =
  "'dislike-button-view-model button, ytd-toggle-button-renderer dislike-button button, ytd-segmented-like-dislike-button-renderer dislike-button button'";

/** like / dislike / remove-rating — watch page. */
function likeScript(kind: "like" | "dislike" | "remove-rating", videoId: string): string {
  const want: "like" | "dislike" = kind === "dislike" ? "dislike" : "like";
  const likeParams = kind === "dislike" ? null : buildLikeParams(videoId, kind !== "like");
  const endpoint = kind === "remove-rating" ? "like/removelike" : "like/like";
  return script(`
const likeBtn=await until(()=>q(${LIKE_SEL}),15000);
if(!likeBtn) return {ok:false,error:'like-button-not-found',path:'ui',dom:${domState()}};
const dislikeBtn=q(${DISLIKE_SEL});
const was={like:pressed(likeBtn),dislike:pressed(dislikeBtn)};
${
  kind === "remove-rating"
    ? `
if(!was.like&&!was.dislike) return {ok:true,verified:true,already:true,rating:null,path:'ui',likesLabel:textOf(likeBtn.closest('like-button-view-model'))||likeBtn.getAttribute('aria-label')||''};
const btn=was.like?likeBtn:dislikeBtn;
btn.click();
const cleared=await until(()=>!pressed(was.like?likeBtn:dislikeBtn),6000);
if(cleared) return {ok:true,verified:true,rating:null,path:'ui'};
const params=${j(likeParams)};
if(!params) return {ok:false,verified:false,error:'click-did-not-clear',path:'ui',dom:{was,url:location.href}};
const res=await post('${endpoint}',{context:CTX(),params});
const after={like:pressed(likeBtn),dislike:pressed(dislikeBtn)};
return {ok:res.ok&&!after.like&&!after.dislike,verified:!after.like&&!after.dislike,path:'fetch',status:res.status,body:res.text,dom:{was,after}};
`
    : `
const btn=${want==="like"?"likeBtn":"dislikeBtn"};
if(!btn) return {ok:false,error:'${want}-button-not-found',path:'ui',dom:${domState()}};
if(was.${want}) return {ok:true,verified:true,already:true,rating:'${want}',path:'ui',likesLabel:textOf(likeBtn.closest('like-button-view-model'))||likeBtn.getAttribute('aria-label')||''};
btn.click();
const flipped=await until(()=>pressed(btn),6000);
if(flipped){
  const container=likeBtn.closest('ytd-segmented-like-dislike-button-renderer, like-button-view-model');
  return {ok:true,verified:true,rating:'${want}',path:'ui',likesLabel:textOf(container)||likeBtn.getAttribute('aria-label')||''};
}
const params=${j(likeParams)};
if(!params) return {ok:false,verified:false,error:'click-did-not-flip; no fetch-fallback template for ${kind}',path:'ui',dom:{was,url:location.href}};
const res=await post('${endpoint}',{context:CTX(),params});
const after={like:pressed(likeBtn),dislike:pressed(dislikeBtn)};
return {ok:res.ok&&after.${want},verified:after.${want},path:'fetch',status:res.status,body:res.text,dom:{was,after}};
`
}
`);
}

const SUB_SEL =
  "'ytd-subscribe-button-renderer button, subscribe-button-view-model button, ytg-subscribe-button-view-model button'";

/** subscribe / unsubscribe — channel page. mode: on|off|toggle (default on). */
function subscribeScript(mode: "on" | "off" | "toggle"): string {
  return script(`
const subBtn=await until(()=>q(${SUB_SEL}),15000);
if(!subBtn) return {ok:false,error:'subscribe-button-not-found',path:'ui',dom:${domState()}};
const isSubbed=(b)=>/subscribed/i.test(textOf(b)+' '+(b.getAttribute('aria-label')||''));
const currently=isSubbed(subBtn);
const mode=${j(mode)};
const want=mode==='on'?true:mode==='off'?false:!currently;
if(currently===want) return {ok:true,verified:true,already:true,subscribed:want,path:'ui'};
subBtn.click();
if(!want){
  const confirmBtn=await until(()=>q("yt-confirm-dialog-renderer #confirm-button, tp-yt-paper-dialog #confirm-button, dialog #confirm-button, #confirm-button"),5000);
  if(confirmBtn) confirmBtn.click();
}
const done=await until(()=>isSubbed(subBtn)===want,8000);
if(done) return {ok:true,verified:true,subscribed:want,path:'ui'};
return {ok:false,verified:false,error:'subscribe-state-unchanged',path:'ui',dom:{label:textOf(subBtn),ariaLabel:subBtn.getAttribute('aria-label')||''}};
`);
}

const BELL_SEL =
  "'yt-notification-preference-toggle-button-renderer button, yt-bell-button-shape button, yt-bell-button-shape-next button, button[aria-label*=\"notification\"]'";

/** bell — channel page. pref: all|personalized|none (notification level). */
function bellScript(pref: string): string {
  return script(`
const bellBtn=await until(()=>q(${BELL_SEL}),15000);
if(!bellBtn) return {ok:false,error:'bell-button-not-found (is the channel subscribed?)',path:'ui',dom:${domState()}};
const menuItems=()=>qa("ytd-compact-link-renderer, ytd-menu-service-item-renderer, yt-multi-page-menu-renderer yt-formatted-string, tp-yt-paper-item, [role='menuitemradio'], [role='option'], yt-list-item-view-model");
bellBtn.click();
const wantText=${j(pref)};
const item=await until(()=>menuItems().find(el=>norm(textOf(el))===norm(wantText)),6000);
if(!item) return {ok:false,error:'bell-menu-item-not-found',path:'ui',dom:{items:menuItems().map(textOf).filter(Boolean).slice(0,12),url:location.href}};
const clickable=item.closest("ytd-compact-link-renderer, ytd-menu-service-item-renderer, tp-yt-paper-item, [role='menuitemradio'], [role='option'], yt-list-item-view-model")||item;
clickable.click();
await S(800);
// verify: re-open the menu and read which item carries the check
const bell2=q(${BELL_SEL});
let checkText=null;
if(bell2){
  bell2.click();
  const checked=await until(()=>q("ytd-compact-link-renderer[aria-checked='true'], [role='menuitemradio'][aria-checked='true'], tp-yt-paper-item[checked], [role='option'][aria-checked='true']"),5000);
  checkText=checked?textOf(checked):null;
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  document.body.click();
}
const matched=checkText!=null&&norm(checkText)===norm(wantText);
return {ok:matched,verified:matched,path:'ui',detail:{selectedPref:checkText},error:matched?undefined:'could-not-confirm-preference'};
`);
}

/** comment-create — watch page. payload.text required. */
function commentCreateScript(text: string, videoId: string): string {
  const needle = text.slice(0, 40);
  return script(`
const commentsAnchor=await until(()=>q("#comments, ytd-comments"),8000);
if(commentsAnchor) commentsAnchor.scrollIntoView({block:'start'});
const box=await until(()=>q("ytd-comment-simplebox-renderer #placeholder-area, #comment-dialog #placeholder-area, #placeholder-area"),15000);
if(!box) return {ok:false,error:'comment-box-not-found',path:'ui',dom:${domState()}};
box.click();
const editor=await until(()=>q("#contenteditable-root"),6000);
if(!editor) return {ok:false,error:'comment-editor-not-found',path:'ui',dom:${domState()}};
editor.focus();
document.execCommand('selectAll',false,null);
document.execCommand('insertText',false,${j(text)});
const submit=await until(()=>{
  const b=q("#submit-button button, #submit-button a, #submit-button yt-button-shape button, ytd-comment-dialog #submit-button");
  if(!b) return null;
  if(b.hasAttribute('disabled')) return null;
  const ad=b.getAttribute('aria-disabled');
  return ad==='true'||ad==='false'?null:b;
},8000);
if(!submit) return {ok:false,error:'submit-button-not-ready',path:'ui',dom:{editorText:textOf(editor).slice(0,80)}};
submit.click();
const needle=${j(needle)};
const found=await until(()=>qa("ytd-comment-renderer #content-text").some(el=>textOf(el).includes(needle)),15000);
if(found) return {ok:true,verified:true,path:'ui'};
const dialogClosed=!q("#contenteditable-root");
if(dialogClosed){
  return {ok:true,verified:false,path:'ui',detail:{note:'editor closed after submit; comment not yet visible in list (sort order)'}};
}
// fetch fallback: page-context create_comment
const res=await post('comment/create_comment',{context:CTX(),videoId:${j(videoId)},commentText:${j(text)}});
return {ok:res.ok,verified:false,path:'fetch',status:res.status,body:res.text};
`);
}

/** comment-reply — watch page. Parent located by text when provided. */
function commentReplyScript(text: string, commentText: string | null): string {
  const needle = commentText ? commentText.slice(0, 60) : null;
  return script(`
const textNeedle=${j(text.slice(0, 40))};
const parentNeedle=${j(needle)};
const findComment=()=>parentNeedle?qa("ytd-comment-renderer").find(el=>{
  const t=textOf(el.querySelector("#content-text"));
  return t&&(t.startsWith(parentNeedle)||parentNeedle.startsWith(t.slice(0,parentNeedle.length)));
}):null;
const comment=await until(findComment,12000);
if(!comment){
  // fetch fallback: page-context create_comment with the parent id
  const res=await post('comment/create_comment',{context:CTX(),commentText:${j(text)},parentId:undefined});
  return {ok:false,verified:false,error:'parent-comment-not-in-dom',path:'fetch',status:res.status,body:res.text,note:'comment-reply needs payload.commentText for the UI path'};
}
const replyBtn=comment.querySelector("#reply-button button, #reply-button yt-button-shape button, #reply-button a");
if(!replyBtn) return {ok:false,error:'reply-button-not-found',path:'ui',dom:{commentText:textOf(comment.querySelector('#content-text')).slice(0,80)}};
replyBtn.click();
const thread=comment.closest("ytd-comment-thread-renderer")||comment;
const editor=await until(()=>thread.querySelector("#contenteditable-root"),6000);
if(!editor) return {ok:false,error:'reply-editor-not-found',path:'ui'};
editor.focus();
document.execCommand('selectAll',false,null);
document.execCommand('insertText',false,${j(text)});
const submit=await until(()=>{
  const b=thread.querySelector("#submit-button button, #submit-button a, #submit-button yt-button-shape button");
  if(!b) return null;
  if(b.hasAttribute('disabled')) return null;
  const ad=b.getAttribute('aria-disabled');
  return ad==='true'||ad==='false'?null:b;
},8000);
if(!submit) return {ok:false,error:'reply-submit-not-ready',path:'ui',dom:{editorText:textOf(editor).slice(0,80)}};
submit.click();
const found=await until(()=>qa("#content-text",thread).some(el=>textOf(el).includes(textNeedle)),15000);
if(found) return {ok:true,verified:true,path:'ui'};
return {ok:true,verified:false,path:'ui',detail:{note:'reply submitted; not yet visible in DOM'}};
`);
}

/** comment-like — watch page. Parent located by text; mode set|toggle. */
function commentLikeScript(commentText: string | null, commentId: string, mode: string): string {
  const needle = commentText ? commentText.slice(0, 60) : null;
  return script(`
const parentNeedle=${j(needle)};
const comment=parentNeedle?await until(()=>qa("ytd-comment-renderer").find(el=>{
  const t=textOf(el.querySelector("#content-text"));
  return t&&(t.startsWith(parentNeedle)||parentNeedle.startsWith(t.slice(0,parentNeedle.length)));
}),12000):null;
if(comment){
  const likeBtn=comment.querySelector("#like-button button, #like-button yt-button-shape button");
  if(!likeBtn) return {ok:false,error:'comment-like-button-not-found',path:'ui'};
  const was=pressed(likeBtn);
  const mode=${j(mode)};
  const want=mode==='toggle'?!was:mode==='remove'?false:true;
  if(was===want) return {ok:true,verified:true,already:true,liked:want,path:'ui'};
  likeBtn.click();
  const done=await until(()=>pressed(likeBtn)===want,6000);
  if(done) return {ok:true,verified:true,liked:want,path:'ui'};
  return {ok:false,verified:false,error:'comment-like-state-unchanged',path:'ui',dom:{was}};
}
// fetch fallback: perform_comment_action (best-known shape, honestly reported)
const res=await post('comment/perform_comment_action',{context:CTX(),actions:[{type:'LIKE',payload:{target:${j(commentId)}}}]});
return {ok:res.ok,verified:false,path:'fetch',status:res.status,body:res.text,note:'fetch fallback; give payload.commentText for the verified UI path'};
`);
}

/* ------------------------------------------------------------------ */
/* WFX2-B-S comment writes — ⋮ menu DOM paths (edit/delete/heart/pin/report) */
/* ------------------------------------------------------------------ */

/** Shared locator + ⋮ menu opener for the comment-menu actions.
 * Returns the script prologue that binds `comment` (the ytd-comment-renderer)
 * or an honest failure object the caller script returns directly. */
const FIND_COMMENT_BY_TEXT = (commentText: string | null) => `
const parentNeedle=${j(commentText ? commentText.slice(0, 60) : null)};
if(!parentNeedle) return {ok:false,error:'commentText-required',path:'ui',note:'the menu actions locate the comment by text; pass payload.commentText'};
const findComment=()=>qa("ytd-comment-renderer").find(el=>{
  const t=textOf(el.querySelector("#content-text"));
  return t&&(t.startsWith(parentNeedle)||parentNeedle.startsWith(t.slice(0,parentNeedle.length)));
});
const commentsAnchor=q("#comments, ytd-comments");
if(commentsAnchor) commentsAnchor.scrollIntoView({block:'start'});
const comment=await until(findComment,15000);
if(!comment) return {ok:false,error:'comment-not-in-dom',path:'ui',dom:{needle:parentNeedle}};
const thread=comment.closest("ytd-comment-thread-renderer")||comment;
const openMenu=async()=>{
  const menuBtn=comment.querySelector("#action-buttons ytd-menu-renderer yt-icon-button#button button, #action-buttons ytd-menu-renderer button, ytd-menu-renderer#menu yt-icon-button#button button, #menu button[aria-label*='more' i], #menu button[aria-label*='actions' i]")||comment.querySelector("#action-buttons button[aria-label*='more' i]");
  if(!menuBtn) return {ok:false,error:'comment-menu-button-not-found',path:'ui',dom:{actions:comment.querySelector("#action-buttons")?1:0}};
  menuBtn.click();
  const item=await until(()=>qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem'], tp-yt-paper-item").find(el=>el.isConnected),6000);
  if(!item) return {ok:false,error:'comment-menu-did-not-open',path:'ui'};
  return null;
};
const menuItem=async(labelRe)=>{
  return await until(()=>qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem'], tp-yt-paper-item").find(el=>labelRe.test(textOf(el))),6000);
};
const closeMenus=()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));};
const menuItemsText=()=>qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem']").map(textOf).filter(Boolean).slice(0,14);`;

/** comment-edit — ⋮ → Edit → the inline editor → replace text → save. */
function commentEditScript(newText: string, commentText: string | null): string {
  return script(`
${FIND_COMMENT_BY_TEXT(commentText)}
const menuErr=await openMenu();
if(menuErr) return menuErr;
const editItem=await menuItem(/^edit$/i);
if(!editItem){closeMenus();return {ok:false,error:'edit-menu-item-not-found',path:'ui',dom:{menu:menuItemsText()},note:'Edit only appears on the operator own comments'};}
editItem.click();
// the inline editable composer appears INSIDE the comment row (contenteditable)
const editor=await until(()=>thread.querySelector("#contenteditable-root"),8000);
if(!editor){closeMenus();return {ok:false,error:'edit-editor-not-found',path:'ui'};}
editor.focus();
document.execCommand('selectAll',false,null);
document.execCommand('insertText',false,${j(newText)});
// the edit bar's save button (check icon, same #submit-button family as the composer)
const submit=await until(()=>{
  const b=thread.querySelector("#submit-button button, #submit-button yt-button-shape button, #submit-button a");
  if(!b) return null;
  if(b.hasAttribute('disabled')) return null;
  return b;
},8000);
if(!submit){closeMenus();return {ok:false,error:'edit-save-not-ready',path:'ui',dom:{editorText:textOf(editor).slice(0,80)}};}
submit.click();
const want=${j(newText.slice(0, 60))};
const done=await until(()=>{
  const el=thread.querySelector("ytd-comment-renderer #content-text, #content-text");
  const t=el?textOf(el):null;
  return t&&t.includes(want)?t:null;
},15000);
const editorClosed=!thread.querySelector("#contenteditable-root");
if(done) return {ok:true,verified:true,path:'ui'};
if(editorClosed) return {ok:true,verified:false,path:'ui',detail:{note:'edit submitted; new text not yet visible in DOM'}};
return {ok:false,verified:false,error:'edit-text-unchanged',path:'ui'};
`);
}

/** comment-delete — ⋮ → Delete → the confirm dialog. */
function commentDeleteScript(commentText: string | null): string {
  return script(`
${FIND_COMMENT_BY_TEXT(commentText)}
const menuErr=await openMenu();
if(menuErr) return menuErr;
const deleteItem=await menuItem(/^delete$/i);
if(!deleteItem){closeMenus();return {ok:false,error:'delete-menu-item-not-found',path:'ui',dom:{menu:menuItemsText()}};}
deleteItem.click();
const confirmBtn=await until(()=>q(${CONFIRM_SEL}),6000);
if(!confirmBtn){closeMenus();return {ok:false,error:'delete-confirm-not-found',path:'ui',dom:{dialogText:(q("yt-confirm-dialog-renderer, tp-yt-paper-dialog")?.textContent||'').slice(0,120)}};}
confirmBtn.click();
const gone=await until(()=>!document.contains(comment),10000);
if(gone) return {ok:true,verified:true,path:'ui'};
const toast=!!q("yt-notification-action-renderer, #toast, tp-yt-paper-toast");
if(toast) return {ok:true,verified:false,path:'ui',detail:{note:'delete confirmed; row removal pending virtualization'}};
return {ok:false,verified:false,error:'comment-still-present',path:'ui'};
`);
}

/** comment-heart — ⋮ → Heart / Remove heart (creator tools). */
function commentHeartScript(commentText: string | null): string {
  return script(`
${FIND_COMMENT_BY_TEXT(commentText)}
const menuErr=await openMenu();
if(menuErr) return menuErr;
const heartItem=await menuItem(/^(remove )?heart$/i);
if(!heartItem){closeMenus();return {ok:false,error:'heart-menu-item-not-found',path:'ui',dom:{menu:menuItemsText()},note:'Heart only appears for the video channel owner (creator mode)'};}
const wasHearted=/^remove heart$/i.test(textOf(heartItem));
heartItem.click();
const heartVisible=()=>!!comment.querySelector("ytd-comment-engagement-bar, #creator-heart, [aria-label*='hearted' i], yt-icon-shape .hearted, #hearted-button[aria-pressed='true']");
const nowHearted=await until(()=>wasHearted?!heartVisible():heartVisible(),8000);
closeMenus();
return {ok:nowHearted,verified:nowHearted,hearted:!wasHearted,path:'ui',error:nowHearted?undefined:'heart-state-unchanged'};
`);
}

/** comment-pin — ⋮ → Pin / Unpin (creator tools, top-level comments only). */
function commentPinScript(commentText: string | null): string {
  return script(`
${FIND_COMMENT_BY_TEXT(commentText)}
const menuErr=await openMenu();
if(menuErr) return menuErr;
const pinItem=await menuItem(/^(un)?pin$/i);
if(!pinItem){closeMenus();return {ok:false,error:'pin-menu-item-not-found',path:'ui',dom:{menu:menuItemsText()},note:'Pin only appears for the video channel owner (creator mode) and on top-level comments'};}
const wasPinned=/^unpin$/i.test(textOf(pinItem));
pinItem.click();
const pinVisible=()=>{const label=comment.querySelector("ytd-pinned-comment-header-renderer, #pinned-comment-header-renderer, [class*='pinned']");return !!label||/pinned/i.test(comment.textContent||'');};
const nowPinned=await until(()=>wasPinned?!pinVisible():pinVisible(),8000);
closeMenus();
return {ok:nowPinned,verified:nowPinned,pinned:!wasPinned,path:'ui',error:nowPinned?undefined:'pin-state-unchanged'};
`);
}

/** comment-report — ⋮ → Report → the report dialog (reason rows) → submit. */
function commentReportScript(commentText: string | null, reason: string | null): string {
  const wantReason = reason ? reason.toLowerCase().slice(0, 60) : null;
  return script(`
${FIND_COMMENT_BY_TEXT(commentText)}
const menuErr=await openMenu();
if(menuErr) return menuErr;
const reportItem=await menuItem(/^report$/i);
if(!reportItem){closeMenus();return {ok:false,error:'report-menu-item-not-found',path:'ui',dom:{menu:menuItemsText()}};}
reportItem.click();
const dialog=await until(()=>q("yt-report-form-modal-renderer, ytd-report-form-modal-renderer, tp-yt-paper-dialog, ytd-dialog-renderer, dialog"),8000);
if(!dialog){closeMenus();return {ok:false,error:'report-dialog-not-found',path:'ui'};}
const reasons=()=>qa("yt-radio-button-renderer, tp-yt-paper-radio-button, [role='radio'], [role='menuitemradio'], yt-formatted-string").map(el=>textOf(el)).filter(t=>t&&t.length>3&&t.length<80);
const reasonRows=()=>qa("yt-radio-button-renderer, tp-yt-paper-radio-button, [role='radio']").filter(el=>textOf(el).length>3);
const want=${j(wantReason)};
let row=want?await until(()=>reasonRows().find(el=>norm(textOf(el)).includes(norm(want))),4000):null;
if(!row){row=await until(()=>reasonRows()[0]||null,4000);}
if(!row){closeMenus();return {ok:false,error:'report-reason-rows-not-found',path:'ui',dom:{reasons:reasons().slice(0,12)}};}
row.click();
await S(300);
// the dialog's submit control (REPORT / NEXT when sub-reasons follow)
const submit=await until(()=>{
  const btns=qa("button, yt-button-shape button").filter(b=>{
    const t=textOf(b);
    return /^(report|next|submit)$/i.test(t)&&!b.hasAttribute('disabled');
  });
  return btns[0]||null;
},6000);
if(!submit){closeMenus();return {ok:false,error:'report-submit-not-found',path:'ui'};}
submit.click();
// a NEXT step leads to sub-reasons — submit through them
for(let step=0;step<2;step++){
  const sub=await until(()=>reasonRows()[0]||null,3000).catch(()=>null);
  const dialogStill=!!q("yt-report-form-modal-renderer, ytd-report-form-modal-renderer, tp-yt-paper-dialog");
  if(!dialogStill) break;
  if(sub){
    sub.click();
    await S(300);
    const s2=await until(()=>{const b=qa("button, yt-button-shape button").filter(x=>/^(report|submit)$/i.test(textOf(x))&&!x.hasAttribute('disabled'))[0];return b||null;},4000);
    if(s2) s2.click();
  }
}
const closed=await until(()=>!q("yt-report-form-modal-renderer, ytd-report-form-modal-renderer, tp-yt-paper-dialog"),8000);
const toast=!!q("yt-notification-action-renderer, #toast, tp-yt-paper-toast");
if(closed||toast) return {ok:true,verified:!!closed,path:'ui',detail:{reason:textOf(row).slice(0,60),toast}};
return {ok:false,verified:false,error:'report-dialog-still-open',path:'ui'};
`);
}

/** watch-later / playlist-add — watch page Save dialog. */
function playlistScript(opts: {
  watchLater: boolean;
  playlistId: string;
  videoId: string;
  title: string | null;
  mode: "add" | "remove" | "toggle";
}): string {
  const { watchLater, playlistId, videoId, title, mode } = opts;
  return script(`
const findSave=()=>qa("#top-level-buttons-computed button, ytd-watch-metadata button, #actions button, button").find(b=>{
  const t=((b.getAttribute('aria-label')||'')+' '+textOf(b)).trim();
  return /^(save|save to playlist|save video)/i.test(t)&&!/saving/i.test(t);
});
const saveBtn=await until(findSave,12000);
if(!saveBtn) return {ok:false,error:'save-button-not-found',path:'ui',dom:${domState()}};
saveBtn.click();
const rows=()=>qa("ytd-playlist-add-to-option-renderer, [role='checkbox'], [role='menuitemcheckbox'], tp-yt-paper-item.yt-playlist-add-to-option-renderer");
const rowLabel=${j(watchLater ? "watch later" : (title ?? "").toLowerCase())};
const row=await until(()=>rows().find(el=>{
  const t=textOf(el)||textOf(el.querySelector('#label, yt-formatted-string, #checkbox-label'));
  return t&&norm(t).includes(norm(rowLabel));
}),8000);
if(!row) return {ok:false,error:'playlist-row-not-found',path:'ui',dom:{rows:rows().map(el=>textOf(el)||textOf(el.querySelector('#label, yt-formatted-string, #checkbox-label'))).filter(Boolean).slice(0,20)}};
const readChecked=(el)=>{
  if(el.getAttribute('aria-checked')==='true') return true;
  if(el.hasAttribute&&el.hasAttribute('checked')) return true;
  const cb=el.querySelector('#checkbox [aria-checked], #checkbox, tp-yt-paper-checkbox');
  return !!(cb&&(cb.getAttribute('aria-checked')==='true'||cb.hasAttribute&&cb.hasAttribute('checked')));
};
const was=readChecked(row);
const mode=${j(mode)};
const want=mode==='add'?true:mode==='remove'?false:!was;
if(was===want){
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  return {ok:true,verified:true,already:true,added:want,path:'ui'};
}
row.click();
await S(700);
const after=readChecked(row);
document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
if(after===want) return {ok:true,verified:true,added:want,path:'ui'};
// fetch fallback: browse/edit_playlist (works for real YouTube playlist ids, WL for watch later)
const action=want?'ACTION_ADD_VIDEO':'ACTION_REMOVE_VIDEO';
const res=await post('browse/edit_playlist',{context:CTX(),playlistId:${j(playlistId)},actions:[Object.assign({action:action},want?{addedVideoId:${j(videoId)}}:{removedVideoId:${j(videoId)}},{videoId:${j(videoId)}})]});
return {ok:res.ok,verified:res.ok,path:'fetch',status:res.status,body:res.text,dom:{was,after}};
`);
}

/** not-interested — home feed (the only surface YouTube offers it on). */
function notInterestedScript(videoId: string): string {
  return script(`
const card=await until(()=>{
  const nodes=qa("ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-video-renderer, ytd-rich-grid-row");
  return nodes.find(n=>{
    const a=n.querySelector("a#thumbnail, a#video-title, a[href*='v=']");
    return a&&(a.href||'').includes('v=' + ${j(videoId)});
  });
},10000);
if(!card) return {ok:false,error:'video-not-in-feed',path:'ui',dom:${domState()},note:'not-interested applies to videos surfaced in the feed; open youtube.com home and retry'};
card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
card.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));
await S(500);
const kebab=card.querySelector("ytd-menu-renderer yt-icon-button#button button, ytd-menu-renderer button, button[aria-label*='Actions'], button[aria-label*='actions'], button[aria-label*='more'], button[aria-label*='More']");
if(!kebab) return {ok:false,error:'kebab-not-found',path:'ui'};
kebab.click();
const item=await until(()=>qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem'], tp-yt-paper-item").find(el=>/not interested/i.test(textOf(el))),6000);
if(!item) return {ok:false,error:'not-interested-menu-item-not-found',path:'ui',dom:{menu:qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem']").map(textOf).filter(Boolean).slice(0,12)}};
item.click();
const gone=await until(()=>!document.contains(card),8000);
const undoToast=!!q("yt-notification-action-renderer, #toast");
if(gone||undoToast) return {ok:true,verified:!!gone,path:'ui'};
return {ok:false,verified:false,error:'card-still-present',path:'ui'};
`);
}

/* ------------------------------------------------------------------ */
/* WFX2-B-B personal surfaces (additive kinds)                         */
/* ------------------------------------------------------------------ */

const CONFIRM_SEL =
  "'yt-confirm-dialog-renderer #confirm-button, tp-yt-paper-dialog #confirm-button, dialog #confirm-button, #confirm-button'";

/** Find a history/playlist card by videoId on the current feed page. */
const FIND_CARD_BY_VIDEO = (videoId: string) => `
const findCard=()=>qa("ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-rich-grid-row, [data-testid]").find(n=>{
  const a=n.querySelector("a#thumbnail, a#video-title, a[href*='v=']");
  return a&&(a.href||'').includes('v=' + ${j(videoId)});
});`;

/** history-remove — /feed/history card kebab → "Remove from watch history". */
function historyRemoveScript(videoId: string): string {
  return script(`
${FIND_CARD_BY_VIDEO(videoId)}
const card=await until(findCard,12000);
if(!card) return {ok:false,error:'video-not-in-history',path:'ui',dom:${domState()}};
card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
card.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));
await S(400);
const kebab=card.querySelector("ytd-menu-renderer yt-icon-button#button button, ytd-menu-renderer button, button[aria-label*='Actions'], button[aria-label*='actions'], button[aria-label*='more'], button[aria-label*='More']");
if(!kebab) return {ok:false,error:'kebab-not-found',path:'ui'};
kebab.click();
const item=await until(()=>qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem'], tp-yt-paper-item").find(el=>/remove from watch history|remove from history/i.test(textOf(el))),6000);
if(!item) return {ok:false,error:'remove-menu-item-not-found',path:'ui',dom:{menu:qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem']").map(textOf).filter(Boolean).slice(0,12)}};
item.click();
const gone=await until(()=>!document.contains(card),8000);
const undoToast=!!q("yt-notification-action-renderer, #toast, tp-yt-paper-toast");
if(gone||undoToast) return {ok:true,verified:!!gone,path:'ui'};
return {ok:false,verified:false,error:'card-still-present',path:'ui'};
`);
}

/** history-clear-all — the right-rail control button + confirm dialog. */
function historyClearAllScript(): string {
  return script(`
const clearBtn=await until(()=>qa("button, a, yt-button-shape button").find(b=>/^clear all watch history$/i.test(textOf(b))),12000);
if(!clearBtn) return {ok:false,error:'clear-all-button-not-found',path:'ui',dom:${domState()}};
clearBtn.click();
const confirmBtn=await until(()=>q(${CONFIRM_SEL}),6000);
if(confirmBtn){confirmBtn.click();}
const toast=await until(()=>q("yt-notification-action-renderer, #toast, tp-yt-paper-toast"),8000);
const anyCard=qa("ytd-rich-item-renderer, ytd-video-renderer").length>0;
if(toast||!anyCard) return {ok:true,verified:!anyCard,path:'ui'};
return {ok:false,verified:false,error:'cards-still-present',path:'ui',dom:{cards:qa("ytd-rich-item-renderer, ytd-video-renderer").length}};
`);
}

/** history-pause — the right-rail Pause/Resume control (confirm dialog on pause). */
function historyPauseScript(paused: boolean): string {
  const wantLabel = paused ? "resume watch history" : "pause watch history";
  return script(`
const findControl=()=>qa("button, a, yt-button-shape button").find(b=>/^(pause|resume) watch history$/i.test(textOf(b)));
const btn=await until(findControl,12000);
if(!btn) return {ok:false,error:'pause-button-not-found',path:'ui',dom:${domState()}};
const labelBefore=textOf(btn);
if(norm(labelBefore)===norm(${j(wantLabel)})) return {ok:true,verified:true,already:true,paused:${j(paused)},path:'ui'};
btn.click();
const confirmBtn=await until(()=>q(${CONFIRM_SEL}),5000);
if(confirmBtn) confirmBtn.click();
const flipped=await until(()=>{
  const b=findControl();
  return b?norm(textOf(b)):null;
},8000);
const ok=flipped===norm(${j(wantLabel)});
return {ok,verified:ok,paused:!ok?null:${j(paused)},path:'ui',error:ok?undefined:'pause-state-unchanged',dom:{labelBefore,labelAfter:flipped}};
`);
}

/** search-history-pause — the history page kebab → Pause/Resume search history. */
function searchHistoryPauseScript(paused: boolean): string {
  const wantLabel = paused ? "resume search history" : "pause search history";
  return script(`
const kebab=await until(()=>qa("button").find(b=>{
  const a=(b.getAttribute('aria-label')||'')+' '+textOf(b);
  return /controls|options|more actions/i.test(a)&&!/pause|resume|clear|manage/i.test(a);
})||q("ytd-browse[page-subtype='history'] #secondary button, #list-container ytd-button-renderer + ytd-button-renderer button"),12000);
if(!kebab) return {ok:false,error:'history-controls-kebab-not-found',path:'ui',dom:${domState()}};
kebab.click();
const items=()=>qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem'], tp-yt-paper-item");
const item=await until(()=>items().find(el=>/^(pause|resume) search history$/i.test(textOf(el))),6000);
if(!item) return {ok:false,error:'search-history-menu-item-not-found',path:'ui',dom:{menu:items().map(textOf).filter(Boolean).slice(0,12),url:location.href}};
const labelBefore=textOf(item);
if(norm(labelBefore)===norm(${j(wantLabel)})) return {ok:true,verified:true,already:true,paused:${j(paused)},path:'ui'};
item.click();
const confirmBtn=await until(()=>q(${CONFIRM_SEL}),5000);
if(confirmBtn) confirmBtn.click();
const done=await until(()=>!/pause|resume/i.test(textOf(q("yt-notification-action-renderer"))||'')?true:null,3000).catch(()=>null);
document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
return {ok:true,verified:false,paused:${j(paused)},path:'ui',detail:{note:'clicked ' + labelBefore + '; verification of search-history state is not readable from this page (myactivity owns it)'}};
`);
}

/** playlist-remove-item — /playlist?list=<id> row kebab → Remove. */
function playlistRemoveItemScript(playlistId: string, videoId: string): string {
  return script(`
${FIND_CARD_BY_VIDEO(videoId)}
const card=await until(findCard,12000);
if(card){
  card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
  card.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));
  await S(400);
  const kebab=card.querySelector("ytd-menu-renderer yt-icon-button#button button, ytd-menu-renderer button, button[aria-label*='Actions'], button[aria-label*='actions'], button[aria-label*='more'], button[aria-label*='More'], yt-icon-button button");
  if(kebab){
    kebab.click();
    const item=await until(()=>qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem'], tp-yt-paper-item").find(el=>/remove from/i.test(textOf(el))),6000);
    if(item){
      item.click();
      const gone=await until(()=>!document.contains(card),8000);
      if(gone) return {ok:true,verified:true,path:'ui'};
      const toast=!!q("yt-notification-action-renderer, #toast, tp-yt-paper-toast");
      if(toast) return {ok:true,verified:false,path:'ui',detail:{note:'toast shown'}};
      return {ok:false,verified:false,error:'card-still-present',path:'ui'};
    }
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    return {ok:false,error:'remove-menu-item-not-found',path:'ui',dom:{menu:qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem']").map(textOf).filter(Boolean).slice(0,12)}};
  }
}
// fetch fallback: browse/edit_playlist ACTION_REMOVE_VIDEO (the verified wire shape)
const res=await post('browse/edit_playlist',{context:CTX(),playlistId:${j(playlistId)},actions:[{action:'ACTION_REMOVE_VIDEO',removedVideoId:${j(videoId)},videoId:${j(videoId)}}]});
return {ok:res.ok,verified:res.ok,path:'fetch',status:res.status,body:res.text};
`);
}

/** playlist-create — /feed/playlists "New playlist" dialog. */
function playlistCreateScript(title: string, visibility: string): string {
  return script(`
const createBtn=await until(()=>qa("button, a, ytd-button-renderer button").find(b=>/new playlist/i.test(textOf(b))),12000);
if(!createBtn){
  // fetch fallback: playlist/create (the web client's own endpoint)
  const res=await post('playlist/create',{context:CTX(),title:${j(title)},privacyStatus:${j(visibility)}});
  return {ok:res.ok,verified:res.ok,path:'fetch',status:res.status,body:res.text,note:'create button not found on this page; used the endpoint directly'};
}
createBtn.click();
const nameInput=await until(()=>q("tp-yt-paper-input #input, input[aria-label*='name' i], #input input"),8000);
if(!nameInput) return {ok:false,error:'name-input-not-found',path:'ui',dom:${domState()}};
nameInput.focus();
nameInput.value=${j(title)};
nameInput.dispatchEvent(new Event('input',{bubbles:true}));
// visibility select when present
const visSelect=q("tp-yt-paper-dropdown-menu, select, yt-select-renderer");
if(visSelect){
  const opt=qa("tp-yt-item, tp-yt-paper-item, option, [role='option']").find(el=>norm(textOf(el))===norm(${j(visibility)}));
  if(opt){visSelect.click();await S(300);opt.click();}
}
const create2=await until(()=>qa("button").find(b=>/^create$/i.test(textOf(b))&&!b.hasAttribute('disabled')),6000);
if(!create2) return {ok:false,error:'dialog-create-button-not-ready',path:'ui'};
create2.click();
const created=await until(()=>/playlist created/i.test(document.body.innerText)||qa("ytd-notification-action-renderer, #toast").length>0,8000);
if(created) return {ok:true,verified:false,path:'ui',detail:{note:'create flow submitted'}};
const res=await post('playlist/create',{context:CTX(),title:${j(title)},privacyStatus:${j(visibility)}});
return {ok:res.ok,verified:res.ok,path:'fetch',status:res.status,body:res.text};
`);
}

/** playlist-delete — /playlist?list=<id> ⋮ menu → Delete playlist (+confirm). */
function playlistDeleteScript(playlistId: string): string {
  return script(`
const kebab=await until(()=>qa("button").find(b=>{
  const a=(b.getAttribute('aria-label')||'')+' '+textOf(b);
  return /more actions|playlist options/i.test(a);
}),12000);
if(kebab){
  kebab.click();
  const item=await until(()=>qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem'], tp-yt-paper-item").find(el=>/delete playlist/i.test(textOf(el))),6000);
  if(item){
    item.click();
    const confirmBtn=await until(()=>q(${CONFIRM_SEL}),6000);
    if(confirmBtn) confirmBtn.click();
    const gone=await until(()=>/deleted/i.test(document.body.innerText)||!q("ytd-playlist-header-renderer, ytd-playlist-video-list-renderer"),8000);
    if(gone) return {ok:true,verified:true,path:'ui'};
    return {ok:true,verified:false,path:'ui',detail:{note:'delete submitted; page state unclear'}};
  }
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  return {ok:false,error:'delete-menu-item-not-found',path:'ui',dom:{menu:qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem']").map(textOf).filter(Boolean).slice(0,12)}};
}
// fetch fallback: browse/delete_playlist (the web client's own endpoint)
const res=await post('browse/delete_playlist',{context:CTX(),playlistId:${j(playlistId)}});
return {ok:res.ok,verified:res.ok,path:'fetch',status:res.status,body:res.text};
`);
}

/** notifications-mark-read — open the bell menu (the real client marks seen
 * on open), then re-read the unseen count from the page's own context. */
function notificationsMarkReadScript(): string {
  return script(`
const bellBtn=await until(()=>q("ytd-notification-topbar-button-renderer button, #notification-button button, button[aria-label*='notification' i]"),12000);
if(!bellBtn) return {ok:false,error:'bell-button-not-found',path:'ui',dom:${domState()}};
bellBtn.click();
const menu=await until(()=>q("ytd-multi-page-menu-renderer, tp-yt-paper-listbox, ytd-notification-renderer"),6000);
await S(1500);
const before=await post('notification/get_unseen_count',{context:CTX()}).then(r=>r.text).catch(()=>null);
document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
document.body.click();
return {ok:!!menu,verified:false,path:'ui',detail:{menuOpened:!!menu,unseenAfter:before}};
`);
}

/* ------------------------------------------------------------------ */
/* WFX2-P2-SO — community posts (the Tier-2 read + post interactions)  */
/* ------------------------------------------------------------------ */

/** In-page deep walk: count nodes that carry the given child key. */
const COUNT_KEY = (key: string) => `
const countKey=(o)=>{let n=0;const walk=(v)=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){for(const x of v)walk(x);return;}if(${JSON.stringify(key)} in v)n++;for(const x of Object.values(v))walk(x);};walk(o);return n;};`;

/** The response-own tab titles present in a browse-shaped payload. */
const TAB_TITLES = () => `
const tabTitles=(o)=>{const out=[];const walk=(v)=>{if(!v||typeof v!=='object'||out.length)return;if(Array.isArray(v)){for(const x of v)walk(x);return;}if(v.tabRenderer&&typeof v.tabRenderer.title==='string')out.push(v.tabRenderer.title);for(const x of Object.values(v))walk(x);};walk(o);return out;};`;

/**
 * community-read — the logged-in browser's OWN community-tab payload. The
 * executor has already navigated the tab to youtube.com/@<handle>/community
 * (a full page load — window.ytInitialData is the fresh browse answer); this
 * extracts it RAW (detail.data) for the app-side mapper — ONE mapper, TWO
 * transports. Healthy = backstage post rows OR the response's own
 * Posts/Community tab strip (a channel-not-found redirect carries neither —
 * honest failure, never a faked empty community tab).
 */
function communityReadScript(): string {
  return script(`
${COUNT_KEY("backstagePostRenderer")}
${TAB_TITLES()}
const data=window.ytInitialData||null;
if(!data) return {ok:false,error:'ytInitialData-not-found',path:'ui',dom:${domState()}};
const postsFound=countKey(data);
const titles=tabTitles(data);
if(postsFound===0&&!titles.some(t=>t==='Posts'||t==='Community')){
  return {ok:false,error:'community-tab-not-rendered',path:'ui',dom:{...${domState()},tabTitles:titles}};
}
return {ok:true,verified:postsFound>0,path:'ui',detail:{data:window.ytInitialData,url:location.href,postsFound,tabTitles:titles}};
`);
}

const POST_SCOPE_SEL =
  "'ytd-backstage-post-thread-renderer, ytd-backstage-post-renderer'";
const POST_LIKE_SEL =
  "\"#like-button button, #like-button yt-button-shape button, like-button-view-model button, ytd-toggle-button-renderer[id='like-button'] button\"";
const POST_DISLIKE_SEL =
  "\"#dislike-button button, #dislike-button yt-button-shape button, dislike-button-view-model button, ytd-toggle-button-renderer[id='dislike-button'] button\"";

/**
 * post-like — the real like/dislike toggle on the post (/post/<postId>),
 * aria-pressed verified end-state (the watch-page likeScript semantics; no
 * protobuf template exists for backstage votes — an unverified click is an
 * honest failure, never a claimed success).
 */
function postLikeScript(action: "like" | "dislike" | "remove"): string {
  return script(`
const post=await until(()=>q(${POST_SCOPE_SEL}),15000);
if(!post) return {ok:false,error:'post-not-found',path:'ui',dom:${domState()}};
const likeBtn=await until(()=>post.querySelector(${POST_LIKE_SEL}),8000);
if(!likeBtn) return {ok:false,error:'post-like-button-not-found',path:'ui',dom:${domState()}};
const dislikeBtn=post.querySelector(${POST_DISLIKE_SEL});
const was={like:pressed(likeBtn),dislike:dislikeBtn?pressed(dislikeBtn):false};
const action=${j(action)};
if(action==='remove'){
  if(!was.like&&!was.dislike) return {ok:true,verified:true,already:true,rating:null,path:'ui'};
  const btn=was.like?likeBtn:(dislikeBtn||likeBtn);
  btn.click();
  const cleared=await until(()=>!pressed(was.like?likeBtn:(dislikeBtn||likeBtn)),6000);
  if(cleared) return {ok:true,verified:true,rating:null,path:'ui'};
  return {ok:false,verified:false,error:'post-rating-did-not-clear',path:'ui',dom:{was}};
}
const btn=action==='like'?likeBtn:dislikeBtn;
if(!btn) return {ok:false,error:'post-'+action+'-button-not-found',path:'ui',dom:${domState()}};
if(was[action]) return {ok:true,verified:true,already:true,rating:action,path:'ui'};
btn.click();
const flipped=await until(()=>pressed(btn),6000);
if(flipped) return {ok:true,verified:true,rating:action,path:'ui'};
return {ok:false,verified:false,error:'post-like-state-unchanged (no fetch-fallback template for backstage votes)',path:'ui',dom:{was}};
`);
}

/**
 * post-comment-create — the /post/<postId> comments simplebox → editor →
 * submit DOM path (the same component family the watch page uses; no
 * verified templated fetch fallback for backstage comments — an unverified
 * submit is honestly reported, never claimed).
 */
function postCommentCreateScript(text: string): string {
  const needle = text.slice(0, 40);
  return script(`
const commentsAnchor=await until(()=>q("#comments, ytd-comments"),8000);
if(commentsAnchor) commentsAnchor.scrollIntoView({block:'start'});
const box=await until(()=>q("ytd-comment-simplebox-renderer #placeholder-area, #comment-dialog #placeholder-area, #placeholder-area"),15000);
if(!box) return {ok:false,error:'post-comment-box-not-found',path:'ui',dom:${domState()}};
box.click();
const editor=await until(()=>q("#contenteditable-root"),6000);
if(!editor) return {ok:false,error:'post-comment-editor-not-found',path:'ui',dom:${domState()}};
editor.focus();
document.execCommand('selectAll',false,null);
document.execCommand('insertText',false,${j(text)});
const submit=await until(()=>{
  const b=q("#submit-button button, #submit-button a, #submit-button yt-button-shape button, ytd-comment-dialog #submit-button");
  if(!b) return null;
  if(b.hasAttribute('disabled')) return null;
  const ad=b.getAttribute('aria-disabled');
  return ad==='true'||ad==='false'?null:b;
},8000);
if(!submit) return {ok:false,error:'post-comment-submit-not-ready',path:'ui',dom:{editorText:textOf(editor).slice(0,80)}};
submit.click();
const needle=${j(needle)};
const found=await until(()=>qa("ytd-comment-renderer #content-text").some(el=>textOf(el).includes(needle)),15000);
if(found) return {ok:true,verified:true,path:'ui'};
const dialogClosed=!q("#contenteditable-root");
if(dialogClosed) return {ok:true,verified:false,path:'ui',detail:{note:'editor closed after submit; comment not yet visible in list (sort order)'}};
return {ok:false,verified:false,error:'post-comment-not-visible-after-submit',path:'ui'};
`);
}

/**
 * post-comment-like — locate the comment by text in the /post/<postId>
 * comments DOM, click its real like button, verify the aria-pressed flip.
 */
function postCommentLikeScript(commentText: string | null, mode: string): string {
  const needle = commentText ? commentText.slice(0, 60) : null;
  return script(`
const parentNeedle=${j(needle)};
if(!parentNeedle) return {ok:false,error:'commentText-required',path:'ui',note:'post-comment-like locates the comment by text; pass payload.commentText'};
const commentsAnchor=q("#comments, ytd-comments");
if(commentsAnchor) commentsAnchor.scrollIntoView({block:'start'});
const comment=await until(()=>qa("ytd-comment-renderer").find(el=>{
  const t=textOf(el.querySelector("#content-text"));
  return t&&(t.startsWith(parentNeedle)||parentNeedle.startsWith(t.slice(0,parentNeedle.length)));
}),15000);
if(!comment) return {ok:false,error:'post-comment-not-in-dom',path:'ui',dom:{needle:parentNeedle}};
const likeBtn=comment.querySelector("#like-button button, #like-button yt-button-shape button");
if(!likeBtn) return {ok:false,error:'post-comment-like-button-not-found',path:'ui'};
const was=pressed(likeBtn);
const mode=${j(mode)};
const want=mode==='toggle'?!was:mode==='remove'?false:true;
if(was===want) return {ok:true,verified:true,already:true,liked:want,path:'ui'};
likeBtn.click();
const done=await until(()=>pressed(likeBtn)===want,6000);
if(done) return {ok:true,verified:true,liked:want,path:'ui'};
return {ok:false,verified:false,error:'post-comment-like-state-unchanged',path:'ui',dom:{was}};
`);
}

/**
 * post-create — the OWN channel's backstage composer (the real create flow
 * on youtube.com/@<handle>/community): the create box → the post dialog →
 * text/image/poll fill → POST. The image rides a page-context fetch → blob →
 * the dialog's own file input (a real upload through the real pipeline);
 * poll options fill the dialog's own option fields. Verified end-state: the
 * dialog closes AND the new post renders in the feed; honest failures at
 * every step with the observed DOM.
 */
function postCreateScript(text: string, imageUrl: string | null, pollOptions: string[]): string {
  const needle = text.slice(0, 40);
  return script(`
const CREATE_SEL="ytd-backstage-post-create-renderer #create-icon button, ytd-backstage-post-create-renderer button, button[aria-label*='Create a post' i], #create-icon button, ytd-backstage-post-create-renderer a";
const createBtn=await until(()=>q(CREATE_SEL),15000);
if(!createBtn) return {ok:false,error:'create-post-button-not-found (own channel community tab only)',path:'ui',dom:${domState()}};
createBtn.click();
const dialog=await until(()=>q("ytd-backstage-post-dialog-renderer, backstage-post-dialog"),10000);
if(!dialog) return {ok:false,error:'post-composer-dialog-not-found',path:'ui',dom:{url:location.href}};
const pollOptions=${j(pollOptions)};
const text=${j(text)};
const imageUrl=${j(imageUrl)};
if(pollOptions.length){
  const pollBtn=await until(()=>dialog.querySelector("#poll-button button, #poll-button, yt-button-renderer[aria-label*='poll' i] button, button[aria-label*='poll' i]"),8000);
  if(!pollBtn) return {ok:false,error:'poll-button-not-found',path:'ui',dom:{dialog:textOf(dialog).slice(0,140)}};
  pollBtn.click();
  await S(600);
}
if(imageUrl){
  const imgBtn=await until(()=>dialog.querySelector("#image-button button, #image-button, button[aria-label*='image' i], yt-image-select-button-renderer button"),8000);
  if(imgBtn) imgBtn.click();
  await S(500);
  const input=await until(()=>dialog.querySelector("input[type=file]"),8000);
  if(!input) return {ok:false,error:'image-file-input-not-found',path:'ui',dom:{dialog:textOf(dialog).slice(0,140)}};
  try{
    const res=await fetch(imageUrl,{mode:'cors'});
    if(!res.ok) return {ok:false,error:'image-fetch-failed',path:'ui',detail:{status:res.status}};
    const blob=await res.blob();
    const ext=((blob.type.split('/')[1]||'jpeg').replace(/[^a-z0-9]/gi,'')||'jpeg');
    const file=new File([blob],'image.'+ext,{type:blob.type||'image/jpeg'});
    const dt=new DataTransfer();
    dt.items.add(file);
    input.files=dt.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }catch(e){
    return {ok:false,error:'image-attach-failed',path:'ui',detail:{message:String((e&&e.message)||e)}};
  }
  await S(800);
}
const editor=await until(()=>dialog.querySelector("#contenteditable-root"),8000);
if(!editor) return {ok:false,error:'post-editor-not-found',path:'ui',dom:{dialog:textOf(dialog).slice(0,140)}};
if(text){
  editor.focus();
  document.execCommand('selectAll',false,null);
  document.execCommand('insertText',false,text);
}
if(pollOptions.length){
  // the option fields: the dialog's own editable rows (the main editor is
  // the first #contenteditable-root — the options are the trailing ones);
  // text inputs are the fallback family
  const need=pollOptions.length+(text?1:0);
  let fields=await until(()=>{
    const all=qa("#contenteditable-root",dialog);
    return all.length>=need?all:null;
  },6000);
  if(!fields){
    fields=await until(()=>{
      const inputs=qa("input[type=text], input.poll-option",dialog).filter(i=>!i.disabled);
      return inputs.length>=pollOptions.length?inputs:null;
    },4000);
  }
  if(!fields) return {ok:false,error:'poll-option-fields-not-found',path:'ui',dom:{editors:qa("#contenteditable-root",dialog).length,inputs:qa("input[type=text]",dialog).length}};
  const opts=fields.slice(Math.max(0,fields.length-pollOptions.length));
  for(let i=0;i<opts.length;i++){
    const f=opts[i];
    f.focus();
    if(f.isContentEditable){
      document.execCommand('selectAll',false,null);
      document.execCommand('insertText',false,pollOptions[i]);
    }else{
      f.value=pollOptions[i];
      f.dispatchEvent(new Event('input',{bubbles:true}));
    }
  }
}
const submit=await until(()=>{
  const b=dialog.querySelector("#submit-button button, #submit-button yt-button-shape button, #submit-button a");
  if(!b) return null;
  if(b.hasAttribute('disabled')) return null;
  return b;
},10000);
if(!submit) return {ok:false,error:'post-submit-not-ready',path:'ui',dom:{editorText:textOf(editor).slice(0,80)}};
submit.click();
const needle=${j(needle)};
const dialogGone=await until(()=>!q("ytd-backstage-post-dialog-renderer #contenteditable-root, backstage-post-dialog #contenteditable-root"),10000);
const inFeed=needle?await until(()=>qa("ytd-backstage-post-renderer, ytd-backstage-post-thread-renderer").some(el=>textOf(el).includes(needle)),12000):null;
if(inFeed) return {ok:true,verified:true,path:'ui',detail:{dialogClosed:!!dialogGone}};
if(dialogGone) return {ok:true,verified:false,path:'ui',detail:{note:'composer closed after submit; the new post is not yet visible in the feed (render lag)'}};
return {ok:false,verified:false,error:'post-not-visible-after-submit',path:'ui',dom:${domState()}};
`);
}

/* ------------------------------------------------------------------ */
/* executor entry point                                                */
/* ------------------------------------------------------------------ */

/** Which URL must the tab be on for this action (null = wherever it is). */
export function requiredUrl(req: BrokerActionRequest): string | null {
  const { kind, target, payload } = req;
  switch (kind) {
    case "like":
    case "dislike":
    case "remove-rating":
    case "comment-create":
    case "playlist-add":
    case "watch-later":
      return target.videoId ? `https://www.youtube.com/watch?v=${target.videoId}` : null;
    case "comment-reply":
    case "comment-like":
      if (payload?.videoId || target.videoId) {
        return `https://www.youtube.com/watch?v=${payload?.videoId ?? target.videoId}`;
      }
      return null;
    // WFX2-B-S comment writes — same watch-page surface
    case "comment-edit":
    case "comment-delete":
    case "comment-heart":
    case "comment-pin":
    case "comment-report":
      if (payload?.videoId || target.videoId) {
        return `https://www.youtube.com/watch?v=${payload?.videoId ?? target.videoId}`;
      }
      return null;
    // WFX2-P3-LC: the live chat composer lives on the live watch page
    case "live-chat-send":
      return target.videoId ? `https://www.youtube.com/watch?v=${target.videoId}` : null;
    case "subscribe":
    case "unsubscribe":
    case "bell":
      return target.channelId ? `https://www.youtube.com/channel/${target.channelId}` : null;
    case "not-interested":
      return "https://www.youtube.com/";
    // WFX2-B-B personal surfaces — additive
    case "history-remove":
    case "history-clear-all":
    case "history-pause":
    case "search-history-pause":
      return "https://www.youtube.com/feed/history";
    case "playlist-remove-item":
    case "playlist-delete":
      return target.playlistId
        ? `https://www.youtube.com/playlist?list=${target.playlistId}`
        : null;
    case "playlist-create":
      return "https://www.youtube.com/feed/playlists";
    case "notifications-mark-read":
      return "https://www.youtube.com/";
    // WFX2-P2-SO — community posts (additive)
    case "community-read": {
      const handle = String(payload?.handle ?? "").replace(/^@/, "").trim();
      if (target.channelId && !handle) {
        return `https://www.youtube.com/channel/${target.channelId}/community`;
      }
      return handle ? `https://www.youtube.com/@${handle}/community` : null;
    }
    case "post-like":
    case "post-comment-create":
    case "post-comment-like":
      return target.postId ? `https://www.youtube.com/post/${target.postId}` : null;
    case "post-create": {
      const handle = String(payload?.handle ?? "").replace(/^@/, "").trim();
      if (target.channelId && !handle) {
        return `https://www.youtube.com/channel/${target.channelId}/community`;
      }
      return handle ? `https://www.youtube.com/@${handle}/community` : null;
    }
    default:
      return null;
  }
}

/** Build the page expression for the action (after the tab is in place). */
export function buildScript(req: BrokerActionRequest): { script: string; timeoutMs: number } | null {
  const { kind, target, payload } = req;
  const mode = payload?.mode;
  switch (kind) {
    case "like":
    case "dislike":
    case "remove-rating":
      return { script: likeScript(kind, target.videoId!), timeoutMs: 30000 };
    case "subscribe":
      return { script: subscribeScript(mode === "toggle" || mode === "off" ? mode : "on"), timeoutMs: 30000 };
    case "unsubscribe":
      return { script: subscribeScript("off"), timeoutMs: 30000 };
    case "bell": {
      const pref = (payload?.pref ?? "").toLowerCase();
      return { script: bellScript(pref), timeoutMs: 30000 };
    }
    case "comment-create":
      return { script: commentCreateScript(payload?.text ?? "", target.videoId!), timeoutMs: 45000 };
    case "comment-reply":
      return {
        script: commentReplyScript(payload?.text ?? "", payload?.commentText ?? null),
        timeoutMs: 45000,
      };
    case "comment-like":
      return {
        script: commentLikeScript(payload?.commentText ?? null, target.commentId!, mode ?? "set"),
        timeoutMs: 45000,
      };
    // WFX2-B-S comment writes (⋮ menu DOM paths)
    case "comment-edit":
      return {
        script: commentEditScript(payload?.text ?? "", payload?.commentText ?? null),
        timeoutMs: 45000,
      };
    case "comment-delete":
      return {
        script: commentDeleteScript(payload?.commentText ?? null),
        timeoutMs: 45000,
      };
    case "comment-heart":
      return {
        script: commentHeartScript(payload?.commentText ?? null),
        timeoutMs: 45000,
      };
    case "comment-pin":
      return {
        script: commentPinScript(payload?.commentText ?? null),
        timeoutMs: 45000,
      };
    case "comment-report":
      return {
        script: commentReportScript(payload?.commentText ?? null, payload?.reason ?? null),
        timeoutMs: 45000,
      };
    case "playlist-add":
      return {
        script: playlistScript({
          watchLater: false,
          playlistId: target.playlistId!,
          videoId: payload?.videoId ?? target.videoId!,
          title: payload?.title ?? null,
          mode: (mode as "add" | "remove" | "toggle") ?? "add",
        }),
        timeoutMs: 30000,
      };
    case "watch-later": {
      const m = payload?.add === true ? "add" : payload?.add === false ? "remove" : (mode as "add" | "remove" | "toggle") ?? "toggle";
      return {
        script: playlistScript({
          watchLater: true,
          playlistId: "WL",
          videoId: target.videoId!,
          title: "Watch later",
          mode: m,
        }),
        timeoutMs: 30000,
      };
    }
    case "not-interested":
      return { script: notInterestedScript(target.videoId!), timeoutMs: 30000 };
    // WFX2-B-B personal surfaces — additive
    case "history-remove":
      return { script: historyRemoveScript(target.videoId!), timeoutMs: 30000 };
    case "history-clear-all":
      return { script: historyClearAllScript(), timeoutMs: 30000 };
    case "history-pause":
      return { script: historyPauseScript(payload?.paused !== false), timeoutMs: 30000 };
    case "search-history-pause":
      return { script: searchHistoryPauseScript(payload?.paused !== false), timeoutMs: 30000 };
    case "playlist-remove-item":
      return {
        script: playlistRemoveItemScript(target.playlistId!, payload?.videoId ?? target.videoId!),
        timeoutMs: 30000,
      };
    case "playlist-create": {
      const title = (payload?.title ?? "").trim();
      if (!title) return null;
      const visibility = ["private", "unlisted", "public"].includes(payload?.visibility ?? "")
        ? (payload!.visibility as string)
        : "private";
      return { script: playlistCreateScript(title, visibility), timeoutMs: 45000 };
    }
    case "playlist-delete":
      return { script: playlistDeleteScript(target.playlistId!), timeoutMs: 30000 };
    case "notifications-mark-read":
      return { script: notificationsMarkReadScript(), timeoutMs: 30000 };
    // WFX2-P2-SO — community posts (additive)
    case "community-read":
      return { script: communityReadScript(), timeoutMs: 45000 };
    case "post-like": {
      const action = String(payload?.action ?? "like").toLowerCase();
      const normalized: "like" | "dislike" | "remove" =
        action === "dislike" || action === "remove" ? action : "like";
      return { script: postLikeScript(normalized), timeoutMs: 30000 };
    }
    case "post-comment-create":
      return { script: postCommentCreateScript(payload?.text ?? ""), timeoutMs: 45000 };
    case "post-comment-like":
      return {
        script: postCommentLikeScript(payload?.commentText ?? null, payload?.mode ?? "set"),
        timeoutMs: 45000,
      };
    case "post-create": {
      const text = (payload?.text ?? "").trim();
      const imageUrl =
        typeof payload?.imageUrl === "string" && /^https?:\/\//.test(payload.imageUrl)
          ? payload.imageUrl
          : null;
      const pollOptions = Array.isArray(payload?.pollOptions)
        ? (payload!.pollOptions as unknown[])
            .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
            .map((o) => o.trim())
        : [];
      return {
        script: postCreateScript(text, imageUrl, pollOptions),
        timeoutMs: 60000,
      };
    }
    // WFX2-P3 — lane-owned kinds module routing (pre-seeded by the lead).
    // CORRECTIVE (P3-UP lane, disclosed): the pre-seed landed this routing
    // block at the tail of requiredUrl — a {script,timeoutMs} object can
    // never be a navigation URL (and requiredUrl must be null for
    // upload-execute: the script owns its navigation). Moved to buildScript,
    // the placement the pre-seed commit message itself documents. The
    // live-chat-send case above keeps the watch-page URL in requiredUrl.
    case "upload-execute":
      return uploadExecuteScript(payload);
    case "live-chat-send":
      return liveChatSendScript(String(payload?.message ?? ""));
    default:
      return null;
  }
}

/** Execute the action in the given connected tab. */
export async function executeAction(
  conn: CdpConnection,
  req: BrokerActionRequest
): Promise<BrokerActionResponse> {
  const { kind, target, payload } = req;

  // bell "off" unsubscribes (the UI state-machine semantics)
  if (kind === "bell" && (payload?.pref ?? "").toLowerCase() === "off") {
    return executeAction(conn, { kind: "unsubscribe", target, payload: undefined });
  }

  const url = requiredUrl(req);
  if (url) {
    const current = await conn.evaluate("location.href", 5000).catch(() => null);
    const sameish =
      typeof current === "string" &&
      (current === url || (current.startsWith(url) && "&?#".includes(current[url.length])));
    if (!sameish) {
      await conn.send("Page.navigate", { url }, 15000);
      const t0 = Date.now();
      for (;;) {
        const ready = await conn
          .evaluate(
            "(document.readyState==='complete'||document.readyState==='interactive')?'ready':document.readyState",
            5000
          )
          .catch(() => null);
        if (ready === "ready" || Date.now() - t0 > 20000) break;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  const built = buildScript(req);
  if (!built) return { ok: false, error: `unsupported kind: ${kind as string}` };

  const value = await conn.evaluate(built.script, built.timeoutMs);
  if (value && typeof value === "object" && "__exception" in (value as object)) {
    return { ok: false, error: `page-script-error: ${(value as { __exception: string }).__exception}` };
  }
  if (value === null || value === undefined) {
    return { ok: false, error: "page-script-returned-nothing" };
  }
  return value as BrokerActionResponse;
}
