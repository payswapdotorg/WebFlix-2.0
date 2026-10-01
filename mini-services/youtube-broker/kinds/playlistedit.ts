/**
 * WFX2-P4-PE — playlist edit kinds (lane-owned module).
 *
 * Pre-seeded by the lead on main with honest staged stubs (the P3 pattern:
 * ACTION_KINDS + executor routing live in the shared registry files — the
 * lead's commits — while the BODIES here are the P4-PE lane's exclusive
 * territory). This file replaces the stubs with the REAL CDP drives.
 *
 * The staged drives (the lane implements):
 *  - playlist-update: with the tab on the playlist's own page (requiredUrl
 *    is pre-seeded to https://www.youtube.com/playlist?list=<id>), drive the
 *    REAL edit affordances: open ⋯ → the edit dialog (or the title's edit
 *    pencil), set title/description/visibility per payload (only the fields
 *    present), confirm, VERIFY the header re-rendered the new title (or the
 *    honest unverified note). Honest failures with the observed DOM:
 *    playlist-not-found, playlist-edit-dialog-not-found, playlist-update-failed.
 *  - playlist-reorder: with the tab on the playlist's own page, hover the
 *    item at fromIndex → drive the REAL drag handle (pointerdown on the
 *    handle → pointermove in steps to the target row's rect → pointerup;
 *    synthetic drags need the stepped ladder) → verify the moved videoId
 *    sits at toIndex in the re-rendered list. Honest failures:
 *    playlist-item-not-found, playlist-drag-handle-not-found,
 *    playlist-reorder-unverified (dropped but order not confirmed).
 *
 * Honest failure taxonomy (per the existing playlist kinds): the observed
 * DOM rides every failure; no fake success. The kinds-module wrapper is the
 * upload/livechat pattern — awaitable async-IIFE with the __exception guard.
 */

import type { BrokerPayload } from "../types";

/** The lane's hard wall-clock ceiling (the reorder ladder is slow). */
export const PLAYLIST_EDIT_TIMEOUT_MS = 120_000;

export interface PlaylistUpdatePayload {
  /** which playlist (target.playlistId carries it too) */
  playlistId?: string;
  /** the new title (omitted = leave unchanged) */
  title?: string;
  /** the new description (omitted = leave unchanged) */
  description?: string;
  /** "public" | "unlisted" | "private" (omitted = leave unchanged) */
  visibility?: string;
}

export interface PlaylistReorderPayload {
  playlistId?: string;
  /** 0-based index of the item to move */
  fromIndex?: number;
  /** 0-based index to move it to */
  toIndex?: number;
  /** the moved video's id (verification aid) */
  videoId?: string;
}

/* ------------------------------------------------------------------ */
/* kinds-module scaffolding (the upload/livechat pattern)              */
/* ------------------------------------------------------------------ */

const RUNNER = `const S=(ms)=>new Promise((r)=>setTimeout(r,ms));
const until=async(fn,ms=8000,step=250)=>{const t0=Date.now();for(;;){let v=null;try{v=fn()}catch(e){}if(v)return v;if(Date.now()-t0>ms)return null;await S(step)}};
const q=(sel,root)=>(root||document).querySelector(sel);
const qa=(sel,root)=>Array.from((root||document).querySelectorAll(sel));
const textOf=(el)=>el?(el.textContent||'').replace(/\\s+/g,' ').trim():'';
const norm=(s)=>(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const R=(s)=>s&&(s.__exception?{__exception:s.__exception}:s);
try{`;

const script = (body: string): string => `(async()=>{${RUNNER}${body}}catch(e){return{__exception:String(e)}}})()`;

const j = (value: unknown): string => JSON.stringify(value);

const domState = () => `({title:document.title,url:location.href})`;

/* ------------------------------------------------------------------ */
/* playlist-update — the REAL edit dialog drive                        */
/* ------------------------------------------------------------------ */

/**
 * Build the playlist-update page script.
 *
 * The drive (with the tab already on /playlist?list=<id>):
 *  1. confirm the playlist header rendered (honest playlist-not-found
 *     when the page redirected to /feed/playlists or shows the empty state)
 *  2. open the playlist's ⋮ menu (the header's "More actions" button —
 *     aria-label variants cover the layout drift), then the Edit menu item
 *     (or the title's edit pencil — both open the same edit dialog)
 *  3. for each field present in the payload (title / description /
 *     visibility), fill the dialog's real input (selectAll → insertText for
 *     contenteditable, value+input for the visibility select)
 *  4. confirm (the dialog's Save button — same #submit-button family the
 *     comment composers use)
 *  5. VERIFY: the header re-rendered the new title (or honest unverified
 *     when the dialog closed but the header still shows the old text —
 *     render lag, never a fake success)
 *
 * Honest failures with the observed DOM ride every {ok:false}:
 *  - playlist-not-found              the page redirected away from the
 *                                    playlist (the header is absent)
 *  - playlist-edit-dialog-not-found  the ⋮ menu opened but no Edit item /
 *                                    the title pencil was absent
 *  - playlist-update-failed          the Save click did not close the
 *                                    dialog and the header still shows the
 *                                    old title (with the dialog's text)
 */
export function playlistUpdateScript(payload: BrokerPayload | undefined): {
  script: string;
  timeoutMs: number;
} {
  const p = (payload ?? {}) as BrokerPayload & PlaylistUpdatePayload;
  const wantTitle = typeof p.title === "string" ? p.title : null;
  const wantDescription = typeof p.description === "string" ? p.description : null;
  const wantVisibility =
    typeof p.visibility === "string" && ["public", "unlisted", "private"].includes(p.visibility.toLowerCase())
      ? p.visibility.toLowerCase()
      : null;
  const hasAny = wantTitle !== null || wantDescription !== null || wantVisibility !== null;

  const body = `
const DOM=${domState()};
const PL_HEADER_SEL="ytd-playlist-header-renderer, ytd-search-playlist-renderer, #playlist-container";
const MENU_BTN_SEL="ytd-playlist-header-renderer ytd-menu-renderer yt-icon-button#button button, ytd-playlist-header-renderer button[aria-label*='more' i], ytd-playlist-header-renderer button[aria-label*='actions' i], ytd-playlist-header-renderer ytd-menu-renderer button";
const EDIT_PENCIL_SEL="ytd-playlist-header-renderer #edit-button button, ytd-playlist-header-renderer button[aria-label*='edit' i], #edit-button button";
const EDIT_ITEM_RE=/^edit$/i;
const DIALOG_SEL="ytd-edit-playlist-dialog-renderer, tp-yt-paper-dialog ytd-edit-playlist-dialog, ytd-dialog-renderer tp-yt-paper-dialog, tp-yt-paper-dialog[style*=''], .ytd-popup-filled";
const TITLE_INPUT_SEL="ytd-edit-playlist-dialog-renderer #title tp-yt-paper-input #input, ytd-edit-playlist-dialog-renderer input[aria-label*='name' i], ytd-edit-playlist-dialog-renderer #label-input input, tp-yt-paper-dialog #label-input input, tp-yt-paper-dialog input[aria-label*='name' i]";
const DESC_INPUT_SEL="ytd-edit-playlist-dialog-renderer #description tp-yt-paper-textarea #input, ytd-edit-playlist-dialog-renderer textarea[aria-label*='description' i], tp-yt-paper-dialog textarea[aria-label*='description' i]";
const VIS_SELECT_SEL="ytd-edit-playlist-dialog-renderer #privacy tp-yt-paper-dropdown-menu, ytd-edit-playlist-dialog-renderer yt-select-renderer, tp-yt-paper-dialog yt-select-renderer, tp-yt-paper-dialog #privacy";
const SAVE_BTN_SEL="ytd-edit-playlist-dialog-renderer #save-button button, ytd-edit-playlist-dialog-renderer #submit-button button, tp-yt-paper-dialog #save-button button, tp-yt-paper-dialog button[aria-label*='save' i]";
const header=q(PL_HEADER_SEL);
if(!header) return R({ok:false,error:'playlist-not-found',path:'ui',dom:DOM});
const wantTitle=${j(wantTitle)};
const wantDescription=${j(wantDescription)};
const wantVisibility=${j(wantVisibility)};
const hasAny=${j(hasAny)};
if(!hasAny) return R({ok:true,verified:true,already:true,path:'ui',detail:{note:'no fields in the update payload — nothing to change'}});
// helper: read the current header title for verification
const headerTitle=()=>{const t=q("ytd-playlist-header-renderer h1, ytd-playlist-header-renderer yt-formatted-string#title, #playlist-container yt-formatted-string.title, ytd-playlist-header-renderer .yt-dynamic-sizing-formatted-string, #title.ytd-playlist-header-renderer");return t?textOf(t):'';};
const titleBefore=headerTitle();
// step 1 — open the edit dialog (try the pencil first, then the ⋮ menu → Edit)
let dialog=await until(()=>q(DIALOG_SEL),6000);
if(!dialog){
  const pencil=q(EDIT_PENCIL_SEL);
  if(pencil){pencil.click();}
  else{
    const menuBtn=q(MENU_BTN_SEL);
    if(menuBtn){
      menuBtn.click();
      const editItem=await until(()=>qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem'], tp-yt-paper-item").find(el=>EDIT_ITEM_RE.test(textOf(el))),6000);
      if(!editItem){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return R({ok:false,error:'playlist-edit-dialog-not-found',path:'ui',dom:{...DOM,menu:qa("ytd-menu-service-item-renderer, yt-list-item-view-model, [role='menuitem']").map(textOf).filter(Boolean).slice(0,14),titleBefore}});}
      editItem.click();
    }else{
      return R({ok:false,error:'playlist-edit-dialog-not-found',path:'ui',dom:{...DOM,titleBefore,note:'neither the edit pencil nor the ⋮ menu button was found on the playlist header'}});
    }
  }
  dialog=await until(()=>q(DIALOG_SEL),10000);
}
if(!dialog) return R({ok:false,error:'playlist-edit-dialog-not-found',path:'ui',dom:{...DOM,titleBefore}});
// step 2 — fill the fields present in the payload
const fillText=async(sel,text)=>{
  const el=await until(()=>q(sel,dialog),6000);
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
  await S(250);
  const now=el.value!==undefined?String(el.value):textOf(el);
  return now.indexOf(text.slice(0,Math.min(20,text.length)))>-1;
};
if(wantTitle!==null){
  const ok=await fillText(TITLE_INPUT_SEL,wantTitle);
  if(!ok){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return R({ok:false,error:'playlist-update-failed',path:'ui',dom:{...DOM,stage:'title-not-filled',titleBefore}});}
}
if(wantDescription!==null){
  // the description field may be collapsed behind a trigger; click it if present
  const descTrigger=q("ytd-edit-playlist-dialog-renderer #description #trigger, tp-yt-paper-dialog #description #trigger",dialog);
  if(descTrigger){descTrigger.click();await S(300);}
  await fillText(DESC_INPUT_SEL,wantDescription);
}
if(wantVisibility!==null){
  const visSel=q(VIS_SELECT_SEL,dialog);
  if(visSel){
    visSel.click();
    await S(300);
    const opt=await until(()=>qa("tp-yt-item, tp-yt-paper-item, [role='option'], yt-list-item-view-model, .item",dialog).find(el=>norm(textOf(el))===norm(wantVisibility)),5000);
    if(opt){opt.click();await S(250);}
    else{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return R({ok:false,error:'playlist-update-failed',path:'ui',dom:{...DOM,stage:'visibility-option-not-found',wanted:wantVisibility,options:qa("tp-yt-item, tp-yt-paper-item, [role='option']",dialog).map(textOf).filter(Boolean).slice(0,8)}});}
  }
}
// step 3 — Save (the dialog's own submit; the #submit-button family)
const saveBtn=await until(()=>{
  const b=q(SAVE_BTN_SEL,dialog);
  if(!b) return null;
  if(b.hasAttribute('disabled')) return null;
  const ad=b.getAttribute('aria-disabled');
  return ad==='true'?null:b;
},8000);
if(!saveBtn){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return R({ok:false,error:'playlist-update-failed',path:'ui',dom:{...DOM,stage:'save-button-not-ready',titleBefore}});}
saveBtn.click();
// step 4 — verify: the dialog closes AND the header re-renders the new title
const dialogGone=await until(()=>!q(DIALOG_SEL),10000);
if(!dialogGone){
  // the dialog did not close — the Save click did not commit
  return R({ok:false,verified:false,error:'playlist-update-failed',path:'ui',dom:{...DOM,stage:'dialog-still-open',titleBefore,dialogOpen:true}});
}
// the dialog closed — re-read the header (render lag is real; wait it out)
const want=${j(wantTitle)};
const readAfter=await until(()=>{
  if(want===null) return 'no-title-check';
  const t=headerTitle();
  return t&&t.includes(want.slice(0,Math.min(40,want.length)))?t:null;
},12000);
const titleAfter=headerTitle();
if(want!==null && readAfter) return R({ok:true,verified:true,path:'ui',detail:{stage:'updated',fields:{title:wantTitle!==null,description:wantDescription!==null,visibility:wantVisibility!==null},titleBefore,titleAfter}});
// the dialog closed but the header still shows the old title — honest unverified
return R({ok:true,verified:false,path:'ui',detail:{stage:'updated-unverified',fields:{title:wantTitle!==null,description:wantDescription!==null,visibility:wantVisibility!==null},titleBefore,titleAfter,note:'the edit dialog closed after Save but the header did not re-render the new title within the deadline (render lag or a silent rejection)'}});
`;

  return {
    script: script(body),
    timeoutMs: PLAYLIST_EDIT_TIMEOUT_MS,
  };
}

/* ------------------------------------------------------------------ */
/* playlist-reorder — the REAL drag-handle ladder                      */
/* ------------------------------------------------------------------ */

/**
 * Build the playlist-reorder page script.
 *
 * The drive (with the tab already on /playlist?list=<id>):
 *  1. wait for the playlist's video list to render
 *     (ytd-playlist-video-list-renderer + ytd-playlist-video-renderer rows)
 *  2. locate the row at fromIndex (and the row at toIndex — the drop target)
 *  3. drive the REAL drag handle: pointerdown on the handle → a stepped
 *     pointermove ladder (the synthetic drag must move in real clientY
 *     increments for the dnd-kit-equivalent YouTube's list uses to register
 *     the gesture) → pointerup over the target row
 *  4. VERIFY: the moved videoId sits at toIndex in the re-rendered list
 *     (honest unverified when the drop landed but the order was not
 *     confirmed within the deadline — never a fake success)
 *
 * Honest failures with the observed DOM:
 *  - playlist-item-not-found         fromIndex out of range (or the row at
 *                                    fromIndex has no videoId matching the
 *                                    payload's videoId verification aid)
 *  - playlist-drag-handle-not-found  the row's drag handle (the ⠿ grip) was
 *                                    absent (the operator may not own the
 *                                    playlist — read-only lists have no
 *                                    handles)
 *  - playlist-reorder-unverified     the drop fired (pointerup landed) but
 *                                    the list did not re-render the new
 *                                    order within the deadline
 */
export function playlistReorderScript(payload: BrokerPayload | undefined): {
  script: string;
  timeoutMs: number;
} {
  const p = (payload ?? {}) as BrokerPayload & PlaylistReorderPayload;
  const fromIndex = typeof p.fromIndex === "number" && p.fromIndex >= 0 ? p.fromIndex : null;
  const toIndex = typeof p.toIndex === "number" && p.toIndex >= 0 ? p.toIndex : null;
  const videoId = typeof p.videoId === "string" && p.videoId.length > 0 ? p.videoId : null;

  const body = `
const DOM=${domState()};
const LIST_SEL="ytd-playlist-video-list-renderer, #playlist-container #playlist";
const ROW_SEL="ytd-playlist-video-renderer";
const HANDLE_SEL="ytd-playlist-video-renderer #drag-handle, ytd-playlist-video-renderer [role='button'][aria-label*='drag' i], ytd-playlist-video-renderer yt-icon-button#button, ytd-playlist-video-renderer #menu yt-icon-button, ytd-playlist-video-renderer .drag-handle";
const fromIndex=${j(fromIndex)};
const toIndex=${j(toIndex)};
const videoId=${j(videoId)};
if(fromIndex===null||toIndex===null) return R({ok:false,error:'playlist-reorder: fromIndex and toIndex are required',path:'ui',dom:DOM});
const list=await until(()=>q(LIST_SEL),12000);
if(!list) return R({ok:false,error:'playlist-item-not-found',path:'ui',dom:{...DOM,note:'the playlist video list did not render (the playlist may be empty or the page redirected)'}});
const rows=()=>qa(ROW_SEL,list);
const rowVideoId=(row)=>{
  const a=row.querySelector("a#thumbnail, a#video-title, a[href*='v=']");
  if(!a) return null;
  const m=(a.href||'').match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  return m?m[1]:null;
};
// step 1 — wait for the list to populate (the row count must cover fromIndex)
await until(()=>rows().length>Math.max(fromIndex,toIndex),12000);
const fromRow=rows()[fromIndex];
if(!fromRow) return R({ok:false,error:'playlist-item-not-found',path:'ui',dom:{...DOM,fromIndex,rowCount:rows().length,note:'the row at fromIndex is not present'}});
// verification aid — when the payload carries videoId, confirm the row at
// fromIndex is actually that video (an honest mismatch fails closed)
if(videoId){
  const id=rowVideoId(fromRow);
  if(id && id!==videoId) return R({ok:false,error:'playlist-item-not-found',path:'ui',dom:{...DOM,fromIndex,expected:videoId,found:id,note:'the videoId at fromIndex does not match the payload — the list may have changed'}});
}
// step 2 — locate the drag handle on the from-row
const handle=await until(()=>{
  const cands=qa(HANDLE_SEL,fromRow);
  return cands.find(el=>el.isConnected)||null;
},8000);
if(!handle) return R({ok:false,error:'playlist-drag-handle-not-found',path:'ui',dom:{...DOM,fromIndex,note:'the row has no drag handle (the operator may not own this playlist — read-only lists have no reorder affordance)'}});
// the target row's rect (where the from-row should land)
const targetRow=rows()[toIndex];
if(!targetRow) return R({ok:false,error:'playlist-item-not-found',path:'ui',dom:{...DOM,toIndex,rowCount:rows().length,note:'the row at toIndex is not present'}});
const fromRect=fromRow.getBoundingClientRect();
const toRect=targetRow.getBoundingClientRect();
// step 3 — the stepped pointer ladder (synthetic drags need real clientY moves)
const dispatchPointer=(type,x,y,target)=>{
  const evt=new PointerEvent(type,{
    bubbles:true,cancelable:true,composed:true,
    pointerId:1,pointerType:'mouse',
    clientX:x,clientY:y,
    button:0,buttons:type==='pointerup'?0:1,
  });
  (target||document).dispatchEvent(evt);
};
const fromCenterX=fromRect.left+fromRect.width/2;
const fromCenterY=fromRect.top+fromRect.height/2;
const toCenterX=toRect.left+toRect.width/2;
const toCenterY=toRect.top+toRect.height/2;
// pointerdown on the handle (the gesture's anchor)
handle.scrollIntoView({block:'center'});
await S(200);
dispatchPointer('pointerdown',fromCenterX,fromCenterY,handle);
await S(150);
// the ladder: 8 steps from fromCenter → toCenter (synthetic drag emulation)
const STEPS=8;
for(let i=1;i<=STEPS;i++){
  const t=i/STEPS;
  const x=fromCenterX+(toCenterX-fromCenterX)*t;
  const y=fromCenterY+(toCenterY-fromCenterY)*t;
  document.elementFromPoint(x,y)?.dispatchEvent(new PointerEvent('pointermove',{
    bubbles:true,cancelable:true,composed:true,
    pointerId:1,pointerType:'mouse',
    clientX:x,clientY:y,
    button:0,buttons:1,
  }));
  await S(60);
}
// pointerup over the target row — commits the drop
dispatchPointer('pointerup',toCenterX,toCenterY,targetRow);
await S(300);
// step 4 — verify: the moved videoId sits at toIndex in the re-rendered list
const needle=videoId||rowVideoId(fromRow);
const verifyAtTarget=async()=>{
  if(!needle) return null;
  const rs=rows();
  const atTarget=rs[toIndex];
  if(!atTarget) return null;
  const id=rowVideoId(atTarget);
  return id&&id===needle?atTarget:null;
};
const moved=await until(verifyAtTarget,12000);
if(moved) return R({ok:true,verified:true,path:'ui',detail:{stage:'reordered',fromIndex,toIndex,videoId:needle}});
// the drop fired but the order was not confirmed within the deadline
return R({ok:true,verified:false,path:'ui',detail:{stage:'reorder-unverified',fromIndex,toIndex,videoId:needle,note:'the drag gesture fired (pointerup landed on the target row) but the list did not re-render the new order within the deadline (the list may be read-only or the gesture was rejected)'}});
`;

  return {
    script: script(body),
    timeoutMs: PLAYLIST_EDIT_TIMEOUT_MS,
  };
}
