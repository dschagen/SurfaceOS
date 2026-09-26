import {clamp, rectBetween, validRect, homography, project, unproject, cssMatrix, quadValid, polygonsOverlap} from './geometry.js';

const $ = id => document.getElementById(id);
const stage=$('stage'), surfacesLayer=$('surfaces'), setup=$('setup'), calibration=$('calibration');
const dialog=$('dialog'), actions=$('actions'), outline=$('outline'), cursor=$('cursor'), labels=$('surface-labels');
let surfaces=[], draft=[[.11,.22],[.89,.22],[.89,.83],[.11,.83]], windows=[], nextId=1;
let phase='calibration', mode='idle', action=null, interaction=null, operation=null, selectedId=null;
let activeId=null, renderer=null, sourceId=null, destinationId=null, cameraStep=null, pendingImage=null;
const inset=.09;
const status=message=>{$('status').textContent=message;};
const stageSize=()=>({width:stage.clientWidth,height:stage.clientHeight});
const fromClient=(x,y)=>({x:clamp((x-stage.getBoundingClientRect().left)/stage.clientWidth,0,1),y:clamp((y-stage.getBoundingClientRect().top)/stage.clientHeight,0,1)});
const at=p=>document.elementFromPoint(stage.getBoundingClientRect().left+p.x*stage.clientWidth,stage.getBoundingClientRect().top+p.y*stage.clientHeight);
const windowById=id=>windows.find(w=>w.id===id);
const surfaceById=id=>surfaces.find(s=>s.id===id);
const local=(s,p)=>unproject(s.h,p.x,p.y);
const inside=p=>p && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1;
const surfaceAt=p=>surfaces.find(s=>inside(local(s,p)));
const otherWindows=id=>windows.filter(w=>w.surface_id===id);
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function rectStyle(el,r){Object.assign(el.style,{left:`${r.x*100}%`,top:`${r.y*100}%`,width:`${r.width*100}%`,height:`${r.height*100}%`});}
function prompt(title,description,choices){
  dialog.replaceChildren();
  const h=document.createElement('h2');h.textContent=title;
  const p=document.createElement('p');p.textContent=description;
  const row=document.createElement('div');row.className='dialog-options';
  for(const [label,fn] of choices){const button=document.createElement('button');button.textContent=label;button.addEventListener('click',()=>{dialog.hidden=true;fn();});row.append(button);}
  dialog.append(h,p,row);dialog.hidden=false;
  row.firstElementChild?.focus();
}
function closePrompt(){dialog.hidden=true;}
function setSetupMessage(text){$('setup-message').textContent=text;}
function setupPreview(){
  calibration.replaceChildren();
  if(phase==='calibration'){
    calibration.hidden=false;
    const poly=document.createElement('div');poly.className='quad-preview';
    poly.style.clipPath=`polygon(${draft.map(([x,y])=>`${x*100}% ${y*100}%`).join(',')})`;
    calibration.append(poly);
    draft.forEach(([x,y],i)=>{
      const handle=document.createElement('button');handle.type='button';handle.className='corner';handle.dataset.corner=String(i);
      handle.style.left=`${x*100}%`;handle.style.top=`${y*100}%`;
      handle.textContent=String(i+1);handle.title=`Corner ${i+1}: drag onto the physical surface`;
      calibration.append(handle);
    });
  }else if(phase==='camera'){
    calibration.hidden=false;
    const s=surfaces[cameraStep.surface];
    const points=[[inset,inset],[1-inset,inset],[1-inset,1-inset],[inset,1-inset]];
    const p=project(s.h,...points[cameraStep.corner]);
    const marker=document.createElement('div');marker.className='camera-target';marker.style.left=`${p.x*100}%`;marker.style.top=`${p.y*100}%`;marker.textContent=String(cameraStep.corner+1);
    calibration.append(marker);
  }else calibration.hidden=true;
}
function showCalibration(){
  phase='calibration';setup.hidden=false;actions.hidden=true;labels.hidden=true;windows=[];
  $('surface-number').textContent=String(surfaces.length+1);
  setup.querySelector('h1').firstChild.textContent='Define surface ';
  setup.querySelector('p:not(.eyebrow)').textContent='Drag each corner onto the usable boundary of this physical surface. Keep all four corners on one flat plane.';
  $('confirm-surface').hidden=false;$('add-surface').hidden=true;$('finish-setup').hidden=true;
  setSetupMessage('Move the four points, then confirm.');status(`Calibrate surface ${surfaces.length+1}`);
  setupPreview();render();
}
function confirmSurface(){
  if(!quadValid(draft)){setSetupMessage('Corners must form a large, convex quadrilateral in order 1, 2, 3, 4.');return;}
  if(surfaces.some(s=>polygonsOverlap(s.corners,draft))){setSetupMessage('This area overlaps an existing surface in the projector image. Move the points apart.');return;}
  const corners=draft.map(p=>[...p]);
  surfaces.push({id:`surface-${surfaces.length+1}`,number:surfaces.length+1,corners,h:homography(corners),camera:null});
  phase='choice';setupPreview();render();
  setup.querySelector('h1').firstChild.textContent='Surface ';
  setup.querySelector('p:not(.eyebrow)').textContent='Boundary saved for this session. Add another physical area inside the projector beam, or finish setup.';
  $('confirm-surface').hidden=true;$('add-surface').hidden=false;$('finish-setup').hidden=false;
  setSetupMessage('Projector geometry is mapped. Camera input alignment comes next.');
}
function startCameraAlignment(){
  phase='camera';cameraStep={surface:0,corner:0,samples:[]};
  setup.hidden=false;actions.hidden=true;setup.querySelector('h1').firstChild.textContent='Align hand input · surface ';
  $('surface-number').textContent='1';
  setup.querySelector('p:not(.eyebrow)').textContent='Place your index fingertip on the projected numbered target and pinch once. Repeat four times per surface.';
  $('confirm-surface').hidden=true;$('add-surface').hidden=true;$('finish-setup').hidden=false;
  $('finish-setup').textContent='Skip hand alignment';
  setSetupMessage('Hand tracker required. Mouse testing can skip this step.');setupPreview();
  status('Pinch on target 1');
}
function finishSetup(){
  if(phase==='choice'){
    prompt('Align hand input?','This maps camera points to the projected surfaces. Use the tracker and pinch four targets per surface, or continue with a mouse.',[
      ['Align hands',startCameraAlignment],['Continue with mouse',enterWorkspace]]);
  }else enterWorkspace();
}
function enterWorkspace(){
  phase='workspace';mode='idle';setup.hidden=true;calibration.hidden=true;actions.hidden=false;closePrompt();
  $('actions-button').hidden=false;$('manage-button').hidden=false;$('close-button').hidden=false;
  $('finish-setup').textContent='Enter workspace';render();status('Choose New Window, Screenshot, or Ask AI');
}
function addSurface(){
  draft=[[.36,.35],[.64,.35],[.64,.65],[.36,.65]];
  showCalibration();setSetupMessage('Drag all four points to an unused part of the same projector beam.');
}
function getMappedHandPoint(raw){
  let best=null,score=Infinity;
  for(const s of surfaces){
    if(!s.camera) continue;
    const q=unproject(s.camera,raw.x,raw.y);
    if(q && q.x>=-.13 && q.x<=1.13 && q.y>=-.13 && q.y<=1.13){
      const p=project(s.h,inset+(1-2*inset)*q.x,inset+(1-2*inset)*q.y);
      const distance=Math.abs(q.x-clamp(q.x,0,1))+Math.abs(q.y-clamp(q.y,0,1));
      if(distance<score){score=distance;best={x:clamp(p.x,0,1),y:clamp(p.y,0,1)};}
    }
  }
  return best;
}
function recordCameraPoint(event){
  if(event.source!=='hand') {setSetupMessage('Use a hand pinch from the tracker for this alignment, or skip for mouse testing.');return;}
  cameraStep.samples.push([event.x,event.y]);cameraStep.corner++;
  if(cameraStep.corner===4){
    try {
      const samples=cameraStep.samples;
      const signed=samples.reduce((total,p,i)=>total+p[0]*samples[(i+1)%4][1]-p[1]*samples[(i+1)%4][0],0);
      if(Math.abs(signed)<.01)throw new Error('Points are too close together');
      surfaces[cameraStep.surface].camera=homography(samples);
    }catch{
      cameraStep.samples=[];cameraStep.corner=0;setSetupMessage('Those four camera points are invalid. Try this surface again.');setupPreview();return;
    }
    cameraStep.surface++;cameraStep.corner=0;cameraStep.samples=[];
    if(cameraStep.surface===surfaces.length){enterWorkspace();status('Hand alignment complete');return;}
    $('surface-number').textContent=String(cameraStep.surface+1);
  }
  setSetupMessage(`Surface ${cameraStep.surface+1}: pinch on target ${cameraStep.corner+1}.`);
  status(`Pinch on target ${cameraStep.corner+1}`);setupPreview();
}
function pointForEvent(e){
  if(e.source!=='hand')return e;
  const mapped=getMappedHandPoint(e);
  return mapped ? {...e,...mapped} : null;
}
function rectForGesture(e){
  const a=pointForEvent({...e,x:e.x,y:e.y});
  const b=pointForEvent({...e,x:e.x+e.width,y:e.y+e.height});
  return a&&b?rectBetween(a,b):null;
}
function render(){
  surfacesLayer.replaceChildren();const {width,height}=stageSize();
  for(const s of surfaces){
    const plane=document.createElement('div');plane.className='surface-plane';plane.dataset.surfaceId=s.id;
    plane.style.width=`${width}px`;plane.style.height=`${height}px`;
    plane.style.transform=`matrix3d(${cssMatrix(s.h,width,height).join(',')})`;
    const badge=document.createElement('span');badge.className='surface-badge';badge.textContent=`SURFACE ${s.number}`;plane.append(badge);
    for(const w of windows.filter(w=>w.surface_id===s.id)){
      const frame=document.createElement('section');frame.className=`surface-window${w.id===activeId?' active':''}`;
      frame.dataset.windowId=w.id;frame.style.zIndex=String(windows.indexOf(w)+1);rectStyle(frame,w);
      const bar=document.createElement('div');bar.className='window-header';bar.textContent=`${w.content==='picker'?'Select a program':w.content==='ai'?'Ask AI':w.content==='screenshot'?'Screenshot':renderer?.apps?.find(a=>a.type===w.content)?.title||w.content} · ${w.id}`;
      const host=document.createElement('div');host.className='widget-host';renderContent(w,host);
      frame.append(bar,host);
      if(mode==='resize-ready'&&selectedId===w.id) for(const key of ['nw','ne','se','sw']){
        const handle=document.createElement('span');handle.className=`resize-corner ${key}`;handle.dataset.resize=key;frame.append(handle);
      }
      plane.append(frame);
    }
    surfacesLayer.append(plane);
  }
  renderer?.sync?.(windows.map(({id,content})=>({id,content})));
  if(mode!=='surface-pick')labels.hidden=true;
}
function renderContent(w,host){
  if(w.content==='picker'){
    const picker=document.createElement('div');picker.className='picker';
    const list=[{type:'notes',title:'Notes'},...(renderer?.apps||[])];
    w.pickerIndex=clamp(w.pickerIndex||0,0,list.length-1);
    const heading=document.createElement('p');heading.textContent='SELECT A PROGRAM';
    const before=document.createElement('div'),current=document.createElement('strong'),after=document.createElement('div');
    before.textContent=list[(w.pickerIndex-1+list.length)%list.length].title;
    current.textContent=`> ${list[w.pickerIndex].title} <`;
    after.textContent=list[(w.pickerIndex+1)%list.length].title;
    const hint=document.createElement('button');hint.type='button';hint.textContent='Pinch to confirm · Click to confirm';hint.addEventListener('click',()=>selectProgram(w.id));
    picker.append(heading,before,current,after,hint);
    picker.addEventListener('wheel',e=>{e.preventDefault();cyclePicker(w.id,e.deltaY>0?1:-1);},{passive:false});
    host.append(picker);return;
  }
  if(w.content==='notes'){
    const note=document.createElement('textarea');note.className='note-area';note.placeholder='Write here';note.value=w.note||'';
    note.addEventListener('input',()=>{w.note=note.value;});host.append(note);return;
  }
  if(w.content==='screenshot'){
    const image=document.createElement('img');image.className='screenshot-image';image.alt='Captured image';image.src=w.image;host.append(image);return;
  }
  if(w.content==='ai'){
    const panel=document.createElement('div');panel.className='ai-panel';
    const title=document.createElement('strong');title.textContent='Ask AI';
    const message=document.createElement('p');message.textContent=w.message||'Enter a question or capture a physical area. A model connection is needed for an answer.';
    const input=document.createElement('textarea');input.placeholder='Write a question';input.value=w.question||'';input.addEventListener('input',()=>{w.question=input.value;});
    const row=document.createElement('div');row.className='ai-controls';
    const mic=document.createElement('button');mic.textContent='Microphone';mic.addEventListener('click',()=>startVoice(w.id));
    const camera=document.createElement('button');camera.textContent='Camera';camera.addEventListener('click',()=>startAICamera(w.id));
    const send=document.createElement('button');send.textContent='Send';send.addEventListener('click',()=>{w.message='No AI service is connected. Your question is kept in this window.';message.textContent=w.message;});
    row.append(mic,camera,send);panel.append(title,message);
    if(w.image){const preview=document.createElement('img');preview.src=w.image;preview.alt='Attached physical area';preview.className='ai-preview';panel.append(preview);}
    panel.append(input,row);host.append(panel);return;
  }
  if(renderer?.mountApp&&renderer.apps?.some(app=>app.type===w.content)){
    renderer.mountApp({id:w.id,content:w.content},host,()=>{});return;
  }
  const fallback=document.createElement('p');fallback.textContent='This program is unavailable.';host.append(fallback);
}
function cyclePicker(id,delta){const w=windowById(id);if(!w||w.content!=='picker')return;
  const count=1+(renderer?.apps?.length||0);w.pickerIndex=(w.pickerIndex+delta+count)%count;render();}
function selectProgram(id){const w=windowById(id);if(!w||w.content!=='picker')return;
  const list=[{type:'notes'},...(renderer?.apps||[])];w.content=list[w.pickerIndex||0].type;activeId=w.id;render();status(`${w.content} opened`);}
function openActions(){if(phase!=='workspace')return;cancel();actions.hidden=false;status('Choose an action');}
function chooseAction(type){
  if(phase!=='workspace')return;
  if(type==='screenshot'&&windows.length){
    prompt('Screenshot source','What should be captured?',[
      ['Capture window',()=>{operation='capture-source';mode='target';actions.hidden=true;status('Click the window to capture');}],
      ['Capture physical area',()=>arm('physical')],['Cancel',openActions]]);return;
  }
  arm(type==='screenshot'?'physical':type);
}
function arm(type){action=type;mode='armed';interaction=null;actions.hidden=true;outline.hidden=true;
  status(type==='physical'?'Drag to mark a physical area for the camera capture':`Drag a window area on one surface for ${type==='new'?'New Window':'Ask AI'}`);
}
function cancel(){if(phase!=='workspace')return;mode='idle';action=null;interaction=null;operation=null;selectedId=null;destinationId=null;outline.hidden=true;labels.hidden=true;closePrompt();render();}
function showOutline(r){outline.hidden=false;rectStyle(outline,r);}
function candidate(r,allowOverlap=false){
  const corners=[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}];
  const s=surfaceAt(corners[0]);if(!s||corners.some(p=>!inside(local(s,p))))return null;
  const mapped=corners.map(p=>local(s,p));
  const bounds={x:Math.min(...mapped.map(p=>p.x)),y:Math.min(...mapped.map(p=>p.y)),width:Math.max(...mapped.map(p=>p.x))-Math.min(...mapped.map(p=>p.x)),height:Math.max(...mapped.map(p=>p.y))-Math.min(...mapped.map(p=>p.y))};
  if(!validRect(bounds,allowOverlap?[]:otherWindows(s.id)))return null;
  return {s,bounds};
}
function completeDrawing(r){outline.hidden=true;const chosen=candidate(r,action==='physical'||action==='ai-camera');
  if(!chosen){mode='armed';status('Place a larger rectangle entirely within one surface, clear of other windows. Try again.');return;}
  if(action==='capture-window'){mode='idle';action=null;captureWindow(chosen.s,chosen.bounds);return;}
  if(action==='ai-camera'){mode='idle';action=null;capturePhysical(chosen.s,chosen.bounds,sourceId);return;}
  if(action==='physical'){mode='idle';capturePhysical(chosen.s,chosen.bounds);return;}
  if(action==='place-image'){
    addScreenshot(chosen.s,chosen.bounds,pendingImage);pendingImage=null;return;
  }
  const w={id:`window-${nextId++}`,surface_id:chosen.s.id,...chosen.bounds,content:action==='new'?'picker':'ai',pickerIndex:0,note:''};
  windows.push(w);activeId=w.id;mode='idle';action=null;render();status(w.content==='picker'?'Scroll the program list, then pinch or click to confirm':'Ask AI window opened');
}
function confirm(title,description,yes){prompt(title,description,[['Yes',yes],['No',()=>{cancel();status('Canceled');}]]);}
function management(kind){
  if(phase!=='workspace')return;
  confirm(`Do you want to ${kind} a window?`,'Confirm once, then click the target window.',()=>{
    operation=kind;mode='target';actions.hidden=true;status(`Click the window to ${kind}`);
  });
}
function manageMenu(){prompt('Manage windows','Choose an operation.',[
  ['Move',()=>management('move')],['Resize',()=>management('resize')],['Cancel',openActions]]);}
function chooseTarget(id){
  const w=windowById(id);if(!w)return;
  activeId=id;selectedId=id;
  if(operation==='capture-source'){sourceId=id;mode='idle';arm('capture-window');status('Draw a free destination window for the screenshot');return;}
  if(operation==='close'){windows=windows.filter(item=>item.id!==id);activeId=windows.at(-1)?.id||null;cancel();render();status('Window closed');return;}
  if(operation==='resize'){mode='resize-ready';render();status('Drag any corner handle to resize. Escape cancels.');return;}
  if(operation==='move'){
    if(surfaces.length===1){mode='move-ready';render();status('Drag the selected window to a free position');return;}
    prompt('Move to another surface?','You can keep this window here or choose a numbered destination.',[
      ['Same surface',()=>{mode='move-ready';render();status('Drag the selected window to a free position');}],
      ['New surface',showDestinationLabels],['Cancel',openActions]]);
  }
}
function showDestinationLabels(){mode='surface-pick';labels.hidden=false;labels.replaceChildren();
  for(const s of surfaces){if(s.id===windowById(selectedId)?.surface_id)continue;
    const pos=project(s.h,.5,.5);const button=document.createElement('button');button.textContent=`Surface ${s.number}`;
    button.style.left=`${pos.x*100}%`;button.style.top=`${pos.y*100}%`;
    button.addEventListener('click',()=>{destinationId=s.id;labels.hidden=true;mode='transfer-ready';status(`Click a free spot on Surface ${s.number} to place the window`);});labels.append(button);}
  status('Choose a numbered destination surface');}
function placeTransfer(p){const s=surfaceAt(p),w=windowById(selectedId);if(!s||s.id!==destinationId||!w)return;
  const atLocal=local(s,p);const proposed={x:atLocal.x-w.width/2,y:atLocal.y-w.height/2,width:w.width,height:w.height};
  if(!validRect(proposed,otherWindows(s.id))){status('Not enough free space here. Choose another spot.');return;}
  Object.assign(w,proposed);w.surface_id=s.id;activeId=w.id;cancel();status(`Moved to Surface ${s.number}`);
}
function proposedResize(base,corner,dx,dy){let x=base.x,y=base.y,right=base.x+base.width,bottom=base.y+base.height;
  if(corner.includes('w'))x+=dx;else right+=dx;
  if(corner.includes('n'))y+=dy;else bottom+=dy;
  return {x,y,width:right-x,height:bottom-y};}
function deliverContent(w,e){const s=surfaceById(w.surface_id),p=local(s,e);if(!p)return;
  const yTop=w.y+42/stage.clientHeight;
  const host=document.querySelector(`[data-window-id="${w.id}"] .widget-host`);if(!host)return;
  host.dispatchEvent(new CustomEvent('surfaceos:window-pointer',{bubbles:true,detail:{version:1,type:e.type,source:e.source,window_id:w.id,x:(p.x-w.x)/w.width,y:(p.y-yTop)/(w.height-42/stage.clientHeight),dy:e.dy}}));
}
function handleInput(raw,target=null){
  if(raw?.version!==1||typeof raw.type!=='string')return false;
  if(phase==='camera'){
    if(raw.type==='pointer_down'&&Number.isFinite(raw.x)&&Number.isFinite(raw.y))recordCameraPoint(raw);
    return true;
  }
  if(phase!=='workspace')return false;
  if(raw.type==='pointer_cancel'||raw.type==='two_hand_pinch_cancel'){
    if(mode==='content'&&interaction){const w=windowById(interaction.id);if(w)deliverContent(w,{...interaction.last,type:'pointer_cancel'});}
    if(mode==='drawing'||mode==='moving'||mode==='resizing'){mode=mode==='drawing'?'armed':interaction?.returnMode||'idle';interaction=null;outline.hidden=true;render();}
    cursor.hidden=true;return true;
  }
  if(raw.type==='two_hand_single_pinch'){confirm('Open main actions?','Show New Window, Screenshot, and Ask AI.',openActions);return true;}
  if(raw.type==='two_hand_double_pinch'){confirm('Manage windows?','Open Move and Resize options.',manageMenu);return true;}
  if(raw.type==='thumbs_down'){management('close');return true;}
  if(raw.type==='scroll'){
    const point=pointForEvent(raw);if(!point)return false;
    const frame=at(point)?.closest('.surface-window'),w=windowById(frame?.dataset.windowId);
    if(w?.content==='picker'){cyclePicker(w.id,(raw.dy||0)>0?1:-1);return true;}
    if(w){
      const host=frame.querySelector('.widget-host');let node=at(point);
      while(node&&node!==host){
        if(node.scrollHeight>node.clientHeight+2){node.scrollTop+=(raw.dy||0)*stage.clientHeight;break;}
        node=node.parentElement;
      }
      deliverContent(w,{...point,type:'scroll',dy:raw.dy});
    }
    return !!w;
  }
  if(raw.type.startsWith('two_hand_pinch_')){
    if(mode!=='armed'&&mode!=='drawing')return false;
    if(!Number.isFinite(raw.width)||!Number.isFinite(raw.height))return false;
    const r=rectForGesture(raw);if(!r)return false;
    if(raw.type==='two_hand_pinch_start'){mode='drawing';interaction={start:r};showOutline(r);return true;}
    if(raw.type==='two_hand_pinch_move'&&mode==='drawing'){showOutline(r);return true;}
    if(raw.type==='two_hand_pinch_end'&&mode==='drawing'){completeDrawing(r);interaction=null;return true;}
    return false;
  }
  if(!['pointer_move','pointer_down','pointer_up'].includes(raw.type))return false;
  if(!Number.isFinite(raw.x)||!Number.isFinite(raw.y))return false;
  const e=pointForEvent(raw);if(!e)return false;
  target??=at(e);
  if(raw.source==='hand'){cursor.hidden=false;cursor.style.left=`${e.x*100}%`;cursor.style.top=`${e.y*100}%`;}
  if(e.type==='pointer_down'){
    if(raw.source==='hand'&&target?.closest('button')){interaction={button:target.closest('button')};return true;}
    if(mode==='transfer-ready'){placeTransfer(e);return true;}
    if(mode==='target'){
      const id=target?.closest('.surface-window')?.dataset.windowId;if(id){chooseTarget(id);return true;}return false;
    }
    if(mode==='armed'){
      if(!surfaceAt(e)||target?.closest('footer,.panel,.surface-window'))return false;
      mode='drawing';interaction={start:e};showOutline({x:e.x,y:e.y,width:0,height:0});return true;
    }
    if(mode==='move-ready'&&target?.closest('.surface-window')?.dataset.windowId===selectedId){
      const w=windowById(selectedId),s=surfaceById(w.surface_id);mode='moving';interaction={id:w.id,start:local(s,e),base:{x:w.x,y:w.y,width:w.width,height:w.height},lastValid:{x:w.x,y:w.y,width:w.width,height:w.height},returnMode:'move-ready'};return true;
    }
    if(mode==='resize-ready'&&target?.closest('[data-resize]')){
      const corner=target.closest('[data-resize]').dataset.resize,w=windowById(selectedId),s=surfaceById(w.surface_id);mode='resizing';interaction={id:w.id,start:local(s,e),corner,base:{x:w.x,y:w.y,width:w.width,height:w.height},lastValid:{x:w.x,y:w.y,width:w.width,height:w.height},returnMode:'resize-ready'};return true;
    }
    const frame=target?.closest('.surface-window'),w=windowById(frame?.dataset.windowId);
    if(w?.content==='picker'){activeId=w.id;if(raw.source==='hand'){selectProgram(w.id);return true;}return false;}
    if(w){activeId=w.id;if(raw.source==='hand'){mode='content';interaction={id:w.id,last:e};deliverContent(w,e);}return false;}
    return false;
  }
  if(e.type==='pointer_move'){
    if(mode==='drawing'&&interaction?.start){showOutline(rectBetween(interaction.start,e));return true;}
    if((mode==='moving'||mode==='resizing')&&interaction?.id){
      const w=windowById(interaction.id),s=surfaceById(w.surface_id),p=local(s,e);if(!p)return true;
      const dx=p.x-interaction.start.x,dy=p.y-interaction.start.y;
      const proposed=mode==='moving'?{...interaction.base,x:interaction.base.x+dx,y:interaction.base.y+dy}:proposedResize(interaction.base,interaction.corner,dx,dy);
      if(validRect(proposed,otherWindows(s.id),w.id)){Object.assign(w,proposed);interaction.lastValid=proposed;render();}
      else status('Boundary or another window blocks that position');return true;
    }
    if(mode==='content'&&interaction?.id&&raw.source==='hand'){
      const w=windowById(interaction.id);interaction.last=e;if(w)deliverContent(w,e);return true;
    }
    return false;
  }
  if(e.type==='pointer_up'){
    if(interaction?.button&&raw.source==='hand'){
      const button=interaction.button;interaction=null;if(button===target?.closest('button'))button.click();return true;
    }
    if(mode==='drawing'&&interaction?.start){const r=rectBetween(interaction.start,e);interaction=null;completeDrawing(r);return true;}
    if((mode==='moving'||mode==='resizing')&&interaction){interaction=null;mode='idle';selectedId=null;render();status('Window updated');return true;}
    if(mode==='content'&&interaction?.id&&raw.source==='hand'){const w=windowById(interaction.id);if(w)deliverContent(w,e);mode='idle';interaction=null;return true;}
  }
  return false;
}

function addScreenshot(s,bounds,image){
  const w={id:`window-${nextId++}`,surface_id:s.id,...bounds,content:'screenshot',image};
  windows.push(w);activeId=w.id;action=null;mode='idle';render();status('Screenshot opened');
}
function placeCapturedImage(s,bounds,image){
  if(validRect(bounds,otherWindows(s.id))){addScreenshot(s,bounds,image);return;}
  pendingImage=image;arm('place-image');status('Capture ready. Draw a free area for its screenshot window.');
}
async function imageOfElement(node){
  const box=node.getBoundingClientRect();
  const width=Math.max(1,Math.round(node.offsetWidth)),height=Math.max(1,Math.round(node.offsetHeight));
  if(!box.width||!box.height)throw new Error('Source window is empty');
  const copy=node.cloneNode(true);
  const original=node.querySelectorAll('*'),clones=copy.querySelectorAll('*');
  function styles(a,b){const style=getComputedStyle(a);for(const name of style)b.style.setProperty(name,style.getPropertyValue(name),style.getPropertyPriority(name));}
  styles(node,copy);for(let i=0;i<original.length;i++)styles(original[i],clones[i]);
  for(let i=0;i<original.length;i++){
    if(original[i] instanceof HTMLTextAreaElement)clones[i].textContent=original[i].value;
    if(original[i] instanceof HTMLCanvasElement){
      const img=document.createElement('img');img.src=original[i].toDataURL();img.width=original[i].width;img.height=original[i].height;clones[i].replaceWith(img);
    }
  }
  copy.style.width=`${width}px`;copy.style.height=`${height}px`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${new XMLSerializer().serializeToString(copy)}</div></foreignObject></svg>`;
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const img=new Image();img.src=url;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/png');
  }finally{URL.revokeObjectURL(url);}
}
async function captureWindow(s,bounds){
  const source=windowById(sourceId),host=document.querySelector(`[data-window-id="${sourceId}"] .widget-host`);
  if(!source||!host){status('The source window is gone. Choose Screenshot again.');return;}
  try{const image=await imageOfElement(host);addScreenshot(s,bounds,image);}
  catch(error){status(`Digital capture could not render this content: ${error.message}`);prompt('Capture unavailable','Try a different window or use a physical area capture.',[['OK',openActions]]);}
}
async function capturePhysical(s,bounds,intoId=null){
  if(!s.camera){status('Align hand/camera points before capturing a specific physical area.');
    prompt('Camera alignment needed','The projector boundary alone cannot tell the camera which pixels belong to this area. Recalibrate with hand alignment, then capture.',[['OK',openActions]]);return;}
  if(!navigator.mediaDevices?.getUserMedia){status('Camera access is unavailable on this browser or origin.');return;}
  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
    const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;
    await video.play();
    surfacesLayer.style.visibility='hidden';actions.style.visibility='hidden';$('stage').classList.add('capture-dark');
    await nextFrame();await new Promise(resolve=>setTimeout(resolve,150));
    const crop=document.createElement('canvas');const source=document.createElement('canvas');
    source.width=video.videoWidth;source.height=video.videoHeight;
    source.getContext('2d').drawImage(video,0,0);
    crop.width=Math.max(1,Math.min(1200,Math.round(stage.clientWidth*bounds.width)));
    crop.height=Math.max(1,Math.min(800,Math.round(stage.clientHeight*bounds.height)));
    const sourcePixels=source.getContext('2d').getImageData(0,0,source.width,source.height).data;
    const context=crop.getContext('2d'),output=context.createImageData(crop.width,crop.height);
    for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++){
      const u=bounds.x+(x+.5)*bounds.width/crop.width,v=bounds.y+(y+.5)*bounds.height/crop.height;
      const camera=project(s.camera,(u-inset)/(1-2*inset),(v-inset)/(1-2*inset));
      const sx=Math.round(camera.x*source.width),sy=Math.round(camera.y*source.height);
      if(sx<0||sy<0||sx>=source.width||sy>=source.height)continue;
      const from=(sy*source.width+sx)*4,to=(y*crop.width+x)*4;
      for(let channel=0;channel<4;channel++)output.data[to+channel]=sourcePixels[from+channel];
    }
    context.putImageData(output,0,0);
    const image=crop.toDataURL('image/png');
    if(intoId){const w=windowById(intoId);if(w){w.image=image;w.message='Photo attached locally. No AI service is connected yet.';render();status('Physical area attached to Ask AI');}}
    else placeCapturedImage(s,bounds,image);
  }catch(error){status(`Camera capture unavailable: ${error.message}`);prompt('Camera capture unavailable',error.message,[['OK',openActions]]);}
  finally{surfacesLayer.style.visibility='';actions.style.visibility='';stage.classList.remove('capture-dark');stream?.getTracks().forEach(track=>track.stop());}
}
function startAICamera(id){
  confirm('Capture a physical area?','Draw the region on a calibrated surface. The image will be attached to this Ask AI window.',()=>{
    sourceId=id;arm('ai-camera');
  });
}
function startVoice(id){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  const w=windowById(id);
  if(!Recognition){if(w){w.message='Voice input is unavailable in this browser. Type your question instead.';render();}return;}
  const recognition=new Recognition();recognition.lang='en-US';recognition.interimResults=false;
  recognition.onresult=e=>{const current=windowById(id);if(current){current.question=e.results[0][0].transcript;current.message='Question transcribed. No AI service is connected yet.';render();}};
  recognition.onerror=e=>{const current=windowById(id);if(current){current.message=`Microphone unavailable: ${e.error}`;render();}};
  try{recognition.start();if(w){w.message='Listening…';render();}}catch(error){if(w){w.message=`Microphone unavailable: ${error.message}`;render();}}
}
$('confirm-surface').addEventListener('click',confirmSurface);
$('add-surface').addEventListener('click',addSurface);
$('finish-setup').addEventListener('click',finishSetup);
actions.addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(button)chooseAction(button.dataset.action);});
$('actions-button').addEventListener('click',()=>confirm('Open main actions?','Show the three main choices.',openActions));
$('manage-button').addEventListener('click',()=>confirm('Manage windows?','Open Move and Resize options.',manageMenu));
$('close-button').addEventListener('click',()=>management('close'));
$('fullscreen').addEventListener('click',()=>document.fullscreenElement?document.exitFullscreen():stage.requestFullscreen?.());
calibration.addEventListener('pointerdown',e=>{
  if(phase!=='calibration')return;
  const handle=e.target.closest('[data-corner]');if(!handle)return;
  interaction={corner:Number(handle.dataset.corner),pointerId:e.pointerId};handle.setPointerCapture(e.pointerId);e.preventDefault();
});
calibration.addEventListener('pointermove',e=>{
  if(phase!=='calibration'||interaction?.pointerId!==e.pointerId)return;
  const p=fromClient(e.clientX,e.clientY);draft[interaction.corner]=[clamp(p.x,.015,.985),clamp(p.y,.015,.985)];
  const preview=calibration.querySelector('.quad-preview'),handle=calibration.querySelector(`[data-corner="${interaction.corner}"]`);
  preview.style.clipPath=`polygon(${draft.map(([x,y])=>`${x*100}% ${y*100}%`).join(',')})`;
  handle.style.left=`${draft[interaction.corner][0]*100}%`;handle.style.top=`${draft[interaction.corner][1]*100}%`;
});
calibration.addEventListener('pointerup',e=>{if(interaction?.pointerId===e.pointerId)interaction=null;});
calibration.addEventListener('pointercancel',()=>{interaction=null;});
stage.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  const used=handleInput({version:1,type:'pointer_down',...fromClient(e.clientX,e.clientY),source:'mouse'},e.target);
  if(used&&['drawing','moving','resizing'].includes(mode)){stage.setPointerCapture(e.pointerId);e.preventDefault();}
});
stage.addEventListener('pointermove',e=>handleInput({version:1,type:'pointer_move',...fromClient(e.clientX,e.clientY),source:'mouse'},e.target));
stage.addEventListener('pointerup',e=>{
  handleInput({version:1,type:'pointer_up',...fromClient(e.clientX,e.clientY),source:'mouse'},e.target);
  if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);
});
stage.addEventListener('pointercancel',e=>handleInput({version:1,type:'pointer_cancel',source:'mouse'}));
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){cancel();return;}
  if(e.target.matches('textarea,input,[contenteditable]')||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key.toLowerCase()==='f')$('fullscreen').click();
  if(phase==='workspace'&&e.key.toLowerCase()==='n')chooseAction('new');
  if(phase==='workspace'&&mode==='idle'&&activeId&&renderer?.handleKey?.(activeId,{type:'keydown',key:e.key}))e.preventDefault();
});
document.addEventListener('keyup',e=>{if(phase==='workspace'&&mode==='idle'&&activeId)renderer?.handleKey?.(activeId,{type:'keyup',key:e.key});});
window.addEventListener('resize',render);
window.SurfaceOS=Object.freeze({
  dispatchInput:event=>handleInput(event),
  mountWidgetRenderer(value){if(!value||typeof value.renderLayout!=='function')throw new TypeError('Expected renderer');renderer=value;render();},
  getState:()=>({phase,mode,surfaces:structuredClone(surfaces),windows:structuredClone(windows)}),
  reset:()=>{surfaces=[];windows=[];nextId=1;activeId=null;mode='idle';action=null;interaction=null;pendingImage=null;draft=[[.11,.22],[.89,.22],[.89,.83],[.11,.83]];showCalibration();},
});
showCalibration();
