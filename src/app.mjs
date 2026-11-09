import {createProject,validateProject,setTitle,upsertParticipant,removeParticipant,upsertExpense,removeExpense,upsertTransfer,removeTransfer,parseMoney,formatMoney,analyze,limits} from './core.mjs';
import {demoProject} from './demo.mjs';
import {parseProject,serializeProject,exportMemory,exportBalancesCsv,exportAllocationsCsv,exportSuggestionsCsv,exportMarkdown} from './io.mjs';

const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const button=(text,action,label)=>{const b=node('button',text);b.type='button';if(label)b.setAttribute('aria-label',label);b.addEventListener('click',action);return b;};
let project=demoProject(),saved=serializeProject(project),history=[],selected=project.expenses[0]?.id||null;
let drafts=new Map(),participantEditing=null,participantDraft=false,transferEditing=null,transferDraft=false,titleDraft=false,busy=false;
const valueText=cents=>`${Math.floor(cents/100)},${String(cents%100).padStart(2,'0')}`;
const person=id=>project.participants.find(p=>p.id===id);
const display=id=>{const p=person(id);if(!p)return 'Pessoa removida';return project.participants.filter(x=>x.name===p.name).length>1?`${p.name} (${p.id})`:p.name;};
const hasDrafts=()=>drafts.size>0||participantDraft||transferDraft||titleDraft;
const hasWork=()=>serializeProject(project)!==saved||hasDrafts();
const nextId=(prefix,collection)=>{let i=1;while(collection.some(x=>x.id===`${prefix}-${i}`)||drafts.has(`${prefix}-${i}`))i++;return `${prefix}-${i}`;};
function status(message,error=false){$('status').textContent=message;$('status').dataset.error=String(error);}
function errorAt(id,error){const e=$(id);e.textContent=error?error.message||String(error):'';e.hidden=!error;}
function updateDraftState(){
  const count=drafts.size+(participantDraft?1:0)+(transferDraft?1:0)+(titleDraft?1:0);
  $('draft-status').hidden=!count;
  $('draft-status').textContent=`${count} rascunho${count===1?'':'s'} sem aplicar. Os saldos ainda mostram o estado aplicado. Aplique ou descarte antes de gerar relatórios.`;
  for(const b of document.querySelectorAll('[data-export]'))b.disabled=Boolean(count)||busy;
  $('export-note').textContent=count?'Relatórios indisponíveis enquanto houver rascunhos. Guardar JSON salva somente o estado aplicado.':'Nenhum arquivo é salvo automaticamente. Guarde um JSON para continuar depois.';
  $('undo').disabled=!history.length||busy;
  $('expense-state').textContent=drafts.has(selected)?'Rascunho':'Aplicada';
  for(const b of $('expense-list').querySelectorAll('button')){const mark=b.querySelector('.draft-marker');if(mark)mark.hidden=!drafts.has(b.dataset.id);}
  $('discard-expense').disabled=!drafts.has(selected);
}
async function confirmAction(title,message,actionLabel){
  const dialog=$('confirm-dialog');$('confirm-title').textContent=title;$('confirm-message').textContent=message;$('confirm-accept').textContent=actionLabel;
  dialog.returnValue='cancel';
  return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='accept'),{once:true});dialog.showModal();});
}
function commit(next,message){history.push(project);if(history.length>30)history.shift();project=next;renderApplied();status(message);}
function replaceProject(next,message){project=next;history=[];drafts.clear();selected=project.expenses[0]?.id||null;participantEditing=null;participantDraft=false;transferEditing=null;transferDraft=false;titleDraft=false;resetParticipant();resetTransfer();saved=serializeProject(project);renderAll();status(message);}
function renderOptions(select,value,emptyLabel='Selecione uma pessoa'){
  const options=[node('option',emptyLabel)];options[0].value='';
  for(const p of project.participants){const o=node('option',display(p.id));o.value=p.id;options.push(o);}
  select.replaceChildren(...options);select.value=value||'';
}
function renderExpenses(){
  $('expense-count').textContent=String(project.expenses.length);
  const rows=[];
  for(const expense of project.expenses){
    const b=button('',()=>selectExpense(expense.id));b.dataset.id=expense.id;b.className=`expense-item${selected===expense.id?' selected':''}`;b.setAttribute('aria-pressed',String(selected===expense.id));
    b.setAttribute('aria-label',`${expense.description}, ${formatMoney(expense.amountCents)}`);
    b.append(node('strong',expense.description),node('span',formatMoney(expense.amountCents),'expense-value'),node('small',`Pago por ${display(expense.payer)}`));
    const mark=node('span','Rascunho preservado','draft-marker');mark.hidden=!drafts.has(expense.id);b.append(mark);rows.push(b);
  }
  for(const [id,draft] of drafts){if(project.expenses.some(e=>e.id===id))continue;const b=button('',()=>selectExpense(id));b.dataset.id=id;b.className=`expense-item${selected===id?' selected':''}`;b.setAttribute('aria-pressed',String(selected===id));b.append(node('strong',draft.description||'Nova despesa'),node('span','Ainda não aplicada','draft-marker'));rows.push(b);}
  if(!rows.length)rows.push(node('p','Adicione uma pessoa e sua primeira despesa para começar.','empty'));
  $('expense-list').replaceChildren(...rows);
}
function fromExpense(expense){return {id:expense.id,description:expense.description,payer:expense.payer,amount:valueText(expense.amountCents),shares:project.participants.map(p=>({participant:p.id,checked:expense.shares.some(s=>s.participant===p.id),weight:String(expense.shares.find(s=>s.participant===p.id)?.weight||1)}))};}
function activeDraft(){const expense=project.expenses.find(e=>e.id===selected);return drafts.get(selected)||(expense?fromExpense(expense):null);}
function captureExpense(){
  if(!selected)return;
  const shares=[...$('share-inputs').querySelectorAll('.share-row')].map(row=>({participant:row.dataset.id,checked:row.querySelector('[type=checkbox]').checked,weight:row.querySelector('[type=number]').value}));
  drafts.set(selected,{id:selected,description:$('expense-description').value,payer:$('expense-payer').value,amount:$('expense-amount').value,shares});
  errorAt('expense-error',null);renderReceipt();updateDraftState();
}
function readExpense(draft){
  const shares=draft.shares.filter(s=>s.checked).map(s=>{if(!/^[1-9][0-9]*$/.test(s.weight)||!Number.isSafeInteger(Number(s.weight))||Number(s.weight)>limits.weight)throw new Error('Use pesos inteiros de 1 a 1.000.000.000.');return {participant:s.participant,weight:Number(s.weight)};});
  return {id:draft.id,description:draft.description,payer:draft.payer,amountCents:parseMoney(draft.amount),shares};
}
function renderEditor(){
  const draft=activeDraft();const exists=project.expenses.some(e=>e.id===selected);
  $('editor-heading').textContent=exists?'Editar despesa':'Nova despesa';
  $('expense-description').value=draft?.description||'';$('expense-amount').value=draft?.amount||'';renderOptions($('expense-payer'),draft?.payer);
  const shares=[];
  for(const p of project.participants){
    const s=draft?.shares.find(x=>x.participant===p.id)||{checked:false,weight:'1'};const row=node('div',undefined,'share-row');row.dataset.id=p.id;
    const label=node('label');const check=node('input');check.type='checkbox';check.checked=Boolean(s.checked);check.setAttribute('aria-label',`Incluir ${display(p.id)} na divisão`);
    label.append(check,node('span',display(p.id)));const weight=node('input');weight.type='number';weight.min='1';weight.max='1000000000';weight.step='1';weight.value=s.weight;weight.disabled=!s.checked;weight.inputMode='numeric';weight.setAttribute('aria-label',`Peso de ${display(p.id)}`);
    check.addEventListener('change',()=>{weight.disabled=!check.checked;captureExpense();});weight.addEventListener('input',captureExpense);row.append(label,weight);shares.push(row);
  }
  $('share-inputs').replaceChildren(...shares);
  const disabled=!draft||!project.participants.length;
  for(const id of ['expense-description','expense-amount','expense-payer','apply-expense'])$(id).disabled=disabled;
  $('delete-expense').disabled=!exists;$('new-expense').disabled=!project.participants.length;
  errorAt('expense-error',null);renderReceipt();updateDraftState();
}
function renderReceipt(){
  const draft=activeDraft();const receiptState=drafts.has(selected)?'Prévia · ainda não aplicada':'Estado aplicado';$('receipt-state').textContent=receiptState;$('receipt-math').replaceChildren();$('compact-receipt').replaceChildren();
  if(!draft){const text='As parcelas aparecem ao adicionar uma despesa.';$('receipt-content').replaceChildren(node('p',text,'empty'));$('compact-receipt').append(node('p',text,'help'));return;}
  try{
    const expense=readExpense(draft);const temp=upsertExpense(project,expense);const receipt=analyze(temp).receipts.find(r=>r.expenseId===selected);
    const compactHead=node('div',undefined,'section-head');compactHead.append(node('h2',expense.description),node('span',receiptState,'state-label'));const compactRows=node('div',undefined,'compact-parcels');
    for(const a of receipt.allocations.slice(0,4)){const entry=node('div');entry.append(node('span',display(a.participant)),node('strong',formatMoney(a.shareCents)));if(a.extraCents)entry.append(node('small','+1 centavo pelo resto'));compactRows.append(entry);}
    const link=node('a',receipt.allocations.length>4?`Conferir todas as ${receipt.allocations.length} parcelas`:'Conferir pesos e memória');link.href='#receipt-heading';$('compact-receipt').append(compactHead,compactRows,link);
    const table=node('table',undefined,'receipt-table');const caption=node('caption',`Divisão de ${formatMoney(expense.amountCents)}`);caption.className='sr-only';table.append(caption);
    const head=node('thead'),hr=node('tr');for(const [i,title] of ['Pessoa','Peso','Parcela'].entries()){const th=node('th',title,i?'numeric':'');th.scope='col';hr.append(th);}head.append(hr);table.append(head);const body=node('tbody');
    for(const a of receipt.allocations){const tr=node('tr'),name=node('td',display(a.participant));if(a.extraCents)name.append(node('span','+1 centavo pelo resto','extra-label'));tr.append(name,node('td',String(a.weight),'numeric'),node('td',formatMoney(a.shareCents),'numeric'));body.append(tr);$('receipt-math').append(node('p',`${display(a.participant)} [${a.participant}]: ${a.numerator} ÷ ${a.denominator} = ${a.baseCents} centavos inteiros; resto ${a.remainder}; extra ${a.extraCents}.`));}
    table.append(body);const foot=node('tfoot'),fr=node('tr');const total=node('td','Total conferido');total.colSpan=2;fr.append(total,node('td',formatMoney(expense.amountCents),'numeric'));foot.append(fr);table.append(foot);$('receipt-content').replaceChildren(table);
  }catch(error){const text=`Complete a despesa para conferir as parcelas. ${error.message}`;$('receipt-content').replaceChildren(node('p',text,'empty'));$('compact-receipt').replaceChildren(node('p',text,'help'));}
}
function selectExpense(id){selected=id;renderExpenses();renderEditor();}
function renderBalances(){
  const a=analyze(project);$('total-expenses').textContent=formatMoney(a.totalExpenseCents);$('total-transfers').textContent=formatMoney(a.totalTransferCents);$('total-pending').textContent=formatMoney(a.pendingCents);
  const balances=a.participants.map(p=>{const row=node('div',undefined,`balance-row${p.balanceCents>0?' receives':''}`);const name=node('div',display(p.id),'person-name');name.append(node('small',`Parcela ${formatMoney(p.shareCents)} · pagou ${formatMoney(p.paidCents)}`));const value=node('div',formatMoney(Math.abs(p.balanceCents)),'balance-amount');value.append(node('small',p.balanceCents>0?'a receber':p.balanceCents<0?'a compensar':'saldo zerado'));row.append(name,value);return row;});
  $('balances').replaceChildren(...(balances.length?balances:[node('p','Os saldos aparecem com as pessoas do rateio.','empty')]));
  const suggestions=a.suggestions.map(s=>{const li=node('li');const route=node('div',`${display(s.from)} → ${display(s.to)}`,'route');route.append(node('span','Ainda não registrado'));const b=button('Usar',()=>useSuggestion(s),`Preparar acerto de ${display(s.from)} para ${display(s.to)} de ${formatMoney(s.amountCents)}`);li.append(route,node('strong',formatMoney(s.amountCents)),b);return li;});
  $('suggestions').replaceChildren(...(suggestions.length?suggestions:[node('li',a.participants.length?'Os saldos estão compensados.':'Adicione pessoas e despesas para calcular.') ]));
}
function renderParticipants(){
  $('participant-count').textContent=`${project.participants.length} / 100`;
  const rows=project.participants.map(p=>{const row=node('div',undefined,'person-record');const name=node('div',display(p.id));name.append(node('small',`ID: ${p.id}`));row.append(name,button('Editar',()=>editParticipant(p.id),`Editar pessoa ${display(p.id)}`),button('Remover',()=>deleteParticipant(p.id),`Remover pessoa ${display(p.id)}`));return row;});
  $('participant-list').replaceChildren(...(rows.length?rows:[node('p','Comece pelas pessoas que pagam ou participam da divisão.','empty')]));
}
function renderTransfers(){
  $('transfer-count').textContent=String(project.transfers.length);
  const rows=project.transfers.map(t=>{const row=node('div',undefined,'transfer-record');const content=node('div',`${display(t.from)} → ${display(t.to)}`);content.append(node('small',t.note||'Sem nota'));row.append(content,node('strong',formatMoney(t.amountCents)),button('Editar',()=>editTransfer(t.id),`Editar acerto ${t.id}`),button('Remover',()=>deleteTransfer(t.id),`Remover acerto ${t.id}`));return row;});
  $('transfer-list').replaceChildren(...(rows.length?rows:[node('p','Nenhum acerto registrado. As sugestões não entram aqui automaticamente.','empty')]));
  const from=$('transfer-from').value,to=$('transfer-to').value;renderOptions($('transfer-from'),from);renderOptions($('transfer-to'),to);$('save-transfer').disabled=project.participants.length<2;
}
function renderApplied(){
  $('project-name').textContent=project.title;if(!titleDraft)$('title-input').value=project.title;
  $('project-context').textContent=`${project.participants.length} pessoas · ${project.expenses.length} despesas · valores declarados em reais`;
  renderExpenses();renderBalances();renderParticipants();renderTransfers();updateDraftState();
}
function renderAll(){renderApplied();renderEditor();}
function resetParticipant(){participantEditing=null;participantDraft=false;$('participant-name').value='';$('participant-editing').textContent='IDs diferentes mantêm pessoas com o mesmo nome separadas.';$('save-participant').textContent='Adicionar pessoa';$('cancel-participant').hidden=true;errorAt('participant-error',null);}
function resetTransfer(){transferEditing=null;transferDraft=false;$('transfer-amount').value='';$('transfer-note').value='';$('transfer-from').value='';$('transfer-to').value='';$('save-transfer').textContent='Registrar acerto';$('cancel-transfer').hidden=true;errorAt('transfer-error',null);}
async function editParticipant(id){if(participantDraft&&!(await confirmAction('Trocar a edição da pessoa?','O nome que ainda não foi aplicado será descartado.','Trocar edição')))return;participantEditing=id;$('participant-name').value=person(id).name;$('participant-editing').textContent=`Editando ID ${id}. Renomear preserva despesas e acertos.`;$('save-participant').textContent='Aplicar nome';$('cancel-participant').hidden=false;participantDraft=false;errorAt('participant-error',null);updateDraftState();$('participant-name').focus();}
async function deleteParticipant(id){
  try{if([...drafts.values()].some(d=>d.payer===id||d.shares.some(s=>s.participant===id&&s.checked)))throw new Error('Esta pessoa está em um rascunho de despesa. Ajuste ou descarte esse rascunho antes de removê-la.');const next=removeParticipant(project,id);if(await confirmAction('Remover esta pessoa?',`${display(id)} será removido do rateio. Você pode desfazer esta ação. Rascunhos de despesas serão preservados.`, 'Remover pessoa')){if(participantEditing===id)resetParticipant();commit(next,'Pessoa removida.');renderEditor();}}
  catch(error){status(error.message,true);errorAt('participant-error',error);}
}
async function editTransfer(id){if(transferDraft&&!(await confirmAction('Trocar o rascunho de acerto?','O acerto que ainda não foi aplicado será descartado.','Trocar edição')))return;const t=project.transfers.find(x=>x.id===id);transferEditing=id;$('transfer-from').value=t.from;$('transfer-to').value=t.to;$('transfer-amount').value=valueText(t.amountCents);$('transfer-note').value=t.note;$('save-transfer').textContent='Aplicar acerto';$('cancel-transfer').hidden=false;transferDraft=false;errorAt('transfer-error',null);updateDraftState();$('transfer-amount').focus();}
async function deleteTransfer(id){if(await confirmAction('Remover o acerto registrado?','O valor sairá dos acertos declarados e os saldos serão recalculados. As despesas permanecem.','Remover acerto')){if(transferEditing===id)resetTransfer();commit(removeTransfer(project,id),'Acerto removido; despesas preservadas.');}}
async function useSuggestion(s){
  if(transferDraft&&!(await confirmAction('Usar esta sugestão?','O rascunho de acerto atual será substituído. Nenhum acerto será registrado ainda.','Preparar sugestão')))return;
  resetTransfer();$('transfer-from').value=s.from;$('transfer-to').value=s.to;$('transfer-amount').value=valueText(s.amountCents);transferDraft=true;$('cancel-transfer').hidden=false;updateDraftState();status('Sugestão preparada. Confira os dados e use Registrar acerto somente se o grupo declara que ele ocorreu.');$('transfer-amount').focus();
}
function download(text,filename,mime){const blob=new Blob([text],{type:mime});const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const exporters={memory:[exportMemory,'rateio-memoria.json','application/json;charset=utf-8'],balances:[exportBalancesCsv,'rateio-saldos.csv','text/csv;charset=utf-8'],allocations:[exportAllocationsCsv,'rateio-parcelas.csv','text/csv;charset=utf-8'],suggestions:[exportSuggestionsCsv,'rateio-sugestoes.csv','text/csv;charset=utf-8'],markdown:[exportMarkdown,'rateio-relatorio.md','text/markdown;charset=utf-8']};
for(const b of document.querySelectorAll('[data-export]'))b.addEventListener('click',()=>{if(hasDrafts())return;const [fn,name,mime]=exporters[b.dataset.export];download(fn(project),name,mime);status(`${name} enviado ao navegador. Confira se o download terminou.`);});
$('save-project').addEventListener('click',()=>{const text=serializeProject(project);download(text,'rateio-projeto.json','application/json;charset=utf-8');saved=text;status(hasDrafts()?'JSON do estado aplicado enviado ao navegador. Os rascunhos continuam somente nesta aba.':'JSON enviado ao navegador. Confira se o download terminou antes de fechar.');});
$('title-input').addEventListener('input',()=>{titleDraft=$('title-input').value!==project.title;updateDraftState();});
$('title-form').addEventListener('submit',event=>{event.preventDefault();try{const next=setTitle(project,$('title-input').value);titleDraft=false;commit(next,'Nome do rateio aplicado.');}catch(error){status(error.message,true);}});
for(const id of ['expense-description','expense-amount'])$(id).addEventListener('input',captureExpense);
$('expense-payer').addEventListener('change',captureExpense);
$('expense-form').addEventListener('submit',event=>{event.preventDefault();try{const draft=activeDraft();if(!draft)return;const next=upsertExpense(project,readExpense(draft));drafts.delete(selected);commit(next,'Despesa aplicada. Parcelas e saldos recalculados; acertos preservados.');renderEditor();const receipt=document.querySelector('.receipt');receipt.classList.remove('flash');requestAnimationFrame(()=>receipt.classList.add('flash'));}catch(error){errorAt('expense-error',error);status('A despesa não foi aplicada. Corrija o campo indicado; o rascunho foi preservado.',true);}});
$('new-expense').addEventListener('click',()=>{const id=nextId('despesa',[...project.expenses,...[...drafts.keys()].map(id=>({id}))]);drafts.set(id,{id,description:'',payer:project.participants[0]?.id||'',amount:'',shares:project.participants.map(p=>({participant:p.id,checked:true,weight:'1'}))});selected=id;renderExpenses();renderEditor();$('expense-description').focus();status('Nova despesa em rascunho. Complete e aplique para incluí-la no rateio.');});
$('discard-expense').addEventListener('click',async()=>{if(!drafts.has(selected))return;if(!(await confirmAction('Descartar o rascunho desta despesa?','O estado aplicado será preservado. As alterações ainda não aplicadas desta despesa serão perdidas.','Descartar rascunho')))return;const exists=project.expenses.some(x=>x.id===selected);drafts.delete(selected);if(!exists)selected=project.expenses[0]?.id||null;renderExpenses();renderEditor();status('Rascunho descartado; estado aplicado preservado.');});
$('delete-expense').addEventListener('click',async()=>{const expense=project.expenses.find(x=>x.id===selected);if(!expense)return;if(!(await confirmAction('Remover esta despesa?',`${expense.description} sairá da divisão. Os acertos registrados serão preservados e podem deixar saldos diferentes. Você pode desfazer.`, 'Remover despesa')))return;const id=selected;const next=removeExpense(project,id);drafts.delete(id);selected=next.expenses[0]?.id||null;commit(next,'Despesa removida; acertos declarados preservados.');renderEditor();});
$('participant-name').addEventListener('input',()=>{participantDraft=true;$('cancel-participant').hidden=false;errorAt('participant-error',null);updateDraftState();});
$('participant-form').addEventListener('submit',event=>{event.preventDefault();try{const id=participantEditing||nextId('pessoa',project.participants);const next=upsertParticipant(project,{id,name:$('participant-name').value});resetParticipant();commit(next,'Pessoa aplicada. Os IDs mantêm as identidades separadas.');renderEditor();}catch(error){errorAt('participant-error',error);status('Nome não aplicado. A entrada foi preservada.',true);}});
$('cancel-participant').addEventListener('click',async()=>{if(participantDraft&&!(await confirmAction('Descartar a edição do nome?','O nome ainda não aplicado será perdido.','Descartar edição')))return;resetParticipant();updateDraftState();});
for(const id of ['transfer-from','transfer-to','transfer-amount','transfer-note'])$(id).addEventListener(id.includes('amount')||id.includes('note')?'input':'change',()=>{transferDraft=true;$('cancel-transfer').hidden=false;errorAt('transfer-error',null);updateDraftState();});
$('transfer-form').addEventListener('submit',event=>{event.preventDefault();try{const next=upsertTransfer(project,{id:transferEditing||nextId('acerto',project.transfers),from:$('transfer-from').value,to:$('transfer-to').value,amountCents:parseMoney($('transfer-amount').value),note:$('transfer-note').value});resetTransfer();commit(next,'Acerto declarado registrado. Os saldos mudaram; o custo das despesas foi preservado.');}catch(error){errorAt('transfer-error',error);status('Acerto não registrado. Confira as pessoas e o valor; o rascunho foi preservado.',true);}});
$('cancel-transfer').addEventListener('click',async()=>{if(transferDraft&&!(await confirmAction('Descartar o rascunho de acerto?','Nenhum registro aplicado será removido.','Descartar acerto')))return;resetTransfer();updateDraftState();});
$('undo').addEventListener('click',async()=>{if(!history.length)return;if(hasDrafts()&&!(await confirmAction('Desfazer e descartar rascunhos?','O último estado aplicado voltará. Todos os rascunhos atuais serão descartados.','Desfazer alteração')))return;project=history.pop();drafts.clear();titleDraft=false;resetParticipant();resetTransfer();if(!project.expenses.some(x=>x.id===selected))selected=project.expenses[0]?.id||null;renderAll();status('Última alteração aplicada desfeita.');});
for(const [id,loader,label] of [['new-project',createProject,'Novo rateio'],['load-demo',demoProject,'Carregar exemplo']])$(id).addEventListener('click',async()=>{if(hasWork()&&!(await confirmAction(`${label}?`,'O trabalho desta aba, incluindo rascunhos e o histórico de desfazer, será substituído. Guarde seu JSON antes se quiser continuar depois.',label)))return;replaceProject(loader(),id==='load-demo'?'Exemplo fictício carregado: quatro pessoas, três despesas e um acerto declarado.':'Rateio vazio criado. Adicione as pessoas para começar.');});
$('open-project').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;busy=true;updateDraftState();$('open-project').disabled=true;
  try{if(file.size>limits.jsonBytes)throw new Error('O arquivo excede 2 MiB. Abra um projeto menor.');const next=parseProject(new Uint8Array(await file.arrayBuffer()));if(hasWork()&&!(await confirmAction('Abrir o projeto validado?',`O arquivo contém ${next.participants.length} pessoas, ${next.expenses.length} despesas e ${next.transfers.length} acertos. Abrir substituirá o trabalho desta aba e os rascunhos.`, 'Abrir este projeto'))) {status('Abertura cancelada. Projeto e rascunhos preservados.');return;}replaceProject(next,'JSON validado e aberto. Os acertos registrados foram preservados.');}
  catch(error){status(`Arquivo recusado. ${error.message} O projeto e os rascunhos atuais foram preservados.`,true);}
  finally{busy=false;event.target.value='';$('open-project').disabled=false;updateDraftState();}
});
window.addEventListener('beforeunload',event=>{if(hasWork()){event.preventDefault();event.returnValue='';}});
resetParticipant();resetTransfer();renderAll();status('Exemplo fictício carregado. Selecione uma despesa para conferir pesos e parcelas.');
