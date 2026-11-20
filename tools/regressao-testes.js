// Testes de regressão do Meu Caixa (rodam dentro do app, depois de tools/regressao-dados.js). Uma expressão só.
// Cada teste: {id, n: nome, ok, d: detalhe}. O motivo de cada um está em TESTES.md (mesmo id).
(async()=>{
  const R=[],T=today(),cur=T.slice(0,7),brl=s=>parseFloat(String(s).replace(/[^\d,−-]/g,'').replace('−','-').replace(/\./g,'').replace(',','.'))||0,
    near=(a,b)=>Math.abs(a-b)<.006,r2=n=>Math.round(n*100)/100,sum=(l,f)=>r2(l.reduce((a,x)=>a+f(x),0)),wait=ms=>new Promise(r=>setTimeout(r,ms));
  const snap=JSON.stringify(S),reset=()=>{Object.keys(S).forEach(k=>delete S[k]);Object.assign(S,JSON.parse(snap));syncCats();document.querySelectorAll('.mdl').forEach(e=>e.hidden=true);m=cur;$('m').value=m;fillCats();render();renderSheet();renderCx();renderRec()};
  const t=async(id,n,f)=>{if((window.__APOSENTADOS||[]).includes(id)){R.push({id,n,ok:true,skip:true});return}try{const r=await f();R.push({id,n,ok:r===true||(r&&r.ok===true),d:r===true?'':(r&&r.d!==undefined?r.d:String(r))})}catch(e){R.push({id,n,ok:false,d:'erro: '+String(e&&e.message||e)})}try{reset()}catch(e){}};
  const setM=k=>{m=k;$('m').value=k;render()},tab=x=>document.querySelector('nav [data-t='+x+']').click(),type=(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}))},radio=(n,v)=>{const r=document.querySelector('input[name='+n+'][value="'+v+'"]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}))};
  window.confirm=()=>true;reset();

  // ---------- desempenho e integridade ----------
  await t('R02','Desenhar Resumo e Orçamentos com ~1.700 lançamentos em menos de 0,4 s cada',()=>{const a=performance.now();render();const b=performance.now();renderSheet();const c=performance.now();return{ok:b-a<400&&c-b<400,d:'resumo '+Math.round(b-a)+' ms, planilha '+Math.round(c-b)+' ms'}});
  await t('R03','Todo lançamento tem id único',()=>{const n=new Set(S.tx.map(x=>x.id)).size;return{ok:n===S.tx.length,d:S.tx.length-n+' repetido(s)'}});

  // ---------- Resumo ----------
  const esperado=k=>{const tx=S.tx.filter(x=>x.date.slice(0,7)===k),inc=sum(tx.filter(x=>x.type==='in'),x=>x.amount),exp=sum(tx.filter(x=>x.type==='out'),x=>x.amount),
    gDep=sum(tx.filter(x=>x.type==='out'&&x.cat==='Caixinhas'),x=>x.amount),gRet=sum(tx.filter(x=>x.type==='in'&&x.cat==='Caixinhas'),x=>x.amount);
    let fat=0;if(k>=addM(cur,-1))S.cards.forEach(c=>{if(c.cl&&c.dd&&!(S.fp&&S.fp[c.id+'|'+k]))fat+=sum(tx.filter(x=>x.type==='out'&&x.card===c.id),x=>x.amount)});
    const aberto=sum(openOf(k,1),x=>x.v),rcv=recvOf(k);
    return{sobrou:r2(inc-(exp-fat)-aberto+rcv),rec:r2(inc-gRet),desp:r2(exp-gDep-fat),apagar:aberto,fat:r2(fat)}};
  for(const [id,off,nome] of [['R10',0,'mês atual'],['R11',1,'mês seguinte'],['R12',-3,'mês antigo (sem fatura em aberto)']])
    await t(id,'Sobrou, Receitas, Despesas e A pagar batem com a conta feita por fora: '+nome,()=>{const k=addM(cur,off);setM(k);const e=esperado(k),sg=$('lbl').textContent.startsWith('Faltou')?-1:1,g={sobrou:sg*brl($('bal').textContent),rec:brl($('inc').textContent),desp:brl($('exp').textContent),apagar:brl($('cm').textContent)};
      const bad=Object.keys(g).filter(q=>!near(g[q],e[q]));return{ok:!bad.length,d:bad.length?bad.map(q=>q+': tela '+g[q]+' x esperado '+e[q]).join('; '):'sobrou '+g.sobrou+', a pagar '+g.apagar}});
  await t('R13','Fatura em aberto fica no A pagar e fora das Despesas; ao marcar como paga, vira Despesa e o Sobrou não muda',()=>{setM(cur);const e=esperado(cur);if(!(e.fat>0))return'sem fatura em aberto nos dados';const s0=$('bal').textContent,d0=brl($('exp').textContent),a0=brl($('cm').textContent);
    S.cards.forEach(c=>{if(c.cl&&c.dd){S.fp[c.id+'|'+cur]={d:T,v:1}}});render();const d1=brl($('exp').textContent),a1=brl($('cm').textContent);
    return{ok:$('bal').textContent===s0&&near(d1-d0,e.fat)&&near(a0-a1,e.fat),d:'despesas '+d0+' -> '+d1+', a pagar '+a0+' -> '+a1+', fatura '+e.fat}});
  await t('R14','Guardar em caixinha baixa o Sobrou, não entra em Despesas nem no Gasto das Despesas',()=>{setM(cur);const sb=()=>($('lbl').textContent.startsWith('Faltou')?-1:1)*brl($('bal').textContent),s0=sb(),d0=$('exp').textContent,g0=$('rt').textContent;cxMove(S.cx[0],123.45,T,'teste','Pix',true);render();
    return{ok:near(s0-sb(),123.45)&&$('exp').textContent===d0&&$('rt').textContent===g0,d:'sobrou '+s0+' -> '+sb()}});
  await t('R15','Orçado do Resumo é o planejado da planilha (mesma fonte)',()=>{const bad=CATS.out.filter(c=>!near(sbm(c,cur),plan('out',c,cur)));return{ok:!bad.length,d:bad.join(', ')}});
  await t('R16','Lançamentos do mês em ordem pela data da compra (mais nova primeiro)',()=>{setM(cur);const L=S.tx.filter(x=>x.date.slice(0,7)===cur),ids=[...$('list').querySelectorAll('li[data-ed]')].map(l=>l.dataset.ed),d=ids.map(i=>{const x=L.find(y=>String(y.id)===i);return x.pd||x.date});
    return{ok:ids.length===L.length&&d.every((x,i)=>!i||d[i-1]>=x),d:ids.length+' linhas'}});

  // ---------- cartão e parcelas ----------
  await t('R20','Vencimento da fatura: antes/depois do fechamento, virada de ano e mês curto',()=>{const C=[[101,'2026-11-24','2026-12-05'],[101,'2026-11-25','2027-01-05'],[101,'2026-12-26','2027-02-05'],[102,'2026-11-02','2026-11-10'],[102,'2026-11-03','2026-12-10'],[103,'2026-11-03','2026-11-03']],bad=C.filter(c=>invDue(c[0],c[1])!==c[2]);
    S.cards.push({id:104,name:'D31',cl:28,dd:31});const f=invDue(104,'2027-01-29');return{ok:!bad.length&&f==='2027-02-28',d:bad.map(c=>c[1]+' deu '+invDue(c[0],c[1])).join('; ')+' fev: '+f}});
  const parcela=(v,k,n,d)=>{tab('lan');radio('tp','out');radio('pg','Cartão');$('cardsel').value='101';$('c').value='Lazer';$('ds').value='Compra teste';type($('v'),v);$('d').value=d;$('pcx').checked=true;$('pcx').dispatchEvent(new Event('change',{bubbles:true}));$('pk').value=k;$('pn2').value=n;$('add').click();return S.tx.filter(x=>x.desc.startsWith('Compra teste'))};
  await t('R21','Compra parcelada: soma das parcelas = valor total (centavos na última) e linha na planilha com a mesma soma',()=>{const L=parcela('10000',1,3,cur+'-10'),row=S.sheet.find(r=>r.sid===L[0].sid);
    return{ok:L.length===3&&near(sum(L,x=>x.amount),100)&&row&&near(sum(Object.values(row.v),x=>x),100)&&new Set(L.map(x=>x.id)).size===3,d:L.map(x=>x.amount).join(' + ')+(row?'':' (sem linha na planilha)')}});
  await t('R22','Parcela 3 de 6: duas parcelas vão para meses anteriores e três para os seguintes',()=>{const L=parcela('60000',3,6,cur+'-10'),ms=L.map(x=>x.date.slice(0,7)).sort(),b=invDue(101,cur+'-10').slice(0,7);
    return{ok:L.length===6&&ms[0]===addM(b,-2)&&ms[5]===addM(b,3)&&new Set(ms).size===6,d:ms[0]+' a '+ms[5]}});
  await t('R23','Excluir UMA parcela pela lixeira da lista tira o valor dela da linha "Parcelas" da planilha',async()=>{const L=parcela('30000',1,3,cur+'-10'),sid=L[0].sid,x=L[0];setM(x.date.slice(0,7));tab('lan');
    const b=$('list').querySelector('button.trash[data-id="'+x.id+'"]');if(!b)return'parcela não apareceu na lista';b.click();await wait(50);const bt=[...document.querySelectorAll('#cfm [data-cfm]')].find(q=>/Só esta/.test(q.textContent));if(!bt)return'sem confirmação "Só esta parcela"';bt.click();
    const row=S.sheet.find(r=>r.sid===sid),rest=sum(S.tx.filter(q=>q.sid===sid),q=>q.amount),pl=row?sum(Object.values(row.v),q=>q):0;return{ok:near(rest,pl),d:'parcelas restantes '+rest+' x planejado na planilha '+pl}});
  await t('R24','Excluir todas as parcelas apaga também a linha "Parcelas" da planilha',async()=>{const L=parcela('30000',1,3,cur+'-10'),sid=L[0].sid;setM(L[0].date.slice(0,7));tab('lan');$('list').querySelector('button.trash[data-id="'+L[0].id+'"]').click();await wait(50);[...document.querySelectorAll('#cfm [data-cfm]')].find(q=>/Excluir as/.test(q.textContent)).click();
    return{ok:!S.tx.some(q=>q.sid===sid)&&!S.sheet.some(r=>r.sid===sid),d:''}});
  await t('R25','Campos de parcela só aparecem com "Compra parcelada" marcada',()=>{tab('lan');radio('tp','out');radio('pg','Cartão');$('pcx').checked=false;$('pcx').dispatchEvent(new Event('change',{bubbles:true}));const a=getComputedStyle($('pcf')).display;radio('pg','Pix');const b=$('par').hidden;return{ok:a==='none'&&b,d:'display '+a}});

  // ---------- compromissos ----------
  await t('R30','Pagar compromisso cria o lançamento; excluir o lançamento devolve o compromisso para A pagar',async()=>{setM(cur);cPg=fnd(410);$('pv').value='980,55';$('pd').value=T;$('pok').click();const c=S.comp.find(x=>x.id===410);if(c.st!=='g'||!S.tx.some(x=>x.id===c.tx))return'não marcou como pago';
    S.tx=S.tx.filter(x=>x.id!==c.tx);save();render();return{ok:c.st==='a'&&!c.tx,d:'status '+c.st}});
  await t('R31','Recorrente no dia 31 cai no último dia de mês curto; sem dia fica sem vencimento; encerrado não volta',()=>{const f=occ('2027-02'),i=f.find(x=>x.rep===302),a=f.find(x=>x.rep===303),e=occ(cur).find(x=>x.rep===304);return{ok:i&&i.d==='2027-02-28'&&a&&a.d===''&&!e,d:(i?i.d:'sem internet')+(e?' encerrado apareceu':'')}});
  await t('R32','Ignorado não entra no A pagar; atrasado de mês anterior entra no A pagar do mês atual',()=>{const o=openOf(cur,1);return{ok:!o.some(x=>x.id===411)&&o.some(x=>x.m<cur&&isLate(x)),d:o.length+' em aberto'}});
  R.push({id:'R40',n:'Servidor (lib/plan.js) calcula as mesmas atrasadas e "vence hoje" do app',ok:false,S:snap,t:T,late:[...lateOld(1),...occ(cur).filter(isLate)].map(x=>x.id).filter((x,i,a)=>a.indexOf(x)===i),due:occ(cur).filter(x=>x.st==='a'&&x.d===T).length});

  // ---------- orçamentos ----------
  await t('R50','Planejado: preencher mês vazio vale até dezembro; editar mês já preenchido muda só ele',()=>{const y=cur.slice(0,4),k=y+'-03';setPlan('out','Pets',k,200);const a=[1,2,3,7,12].map(i=>plan('out','Pets',y+'-'+String(i).padStart(2,'0')));setPlan('out','Pets',y+'-07',350);const b=[6,7,8].map(i=>plan('out','Pets',y+'-'+String(i).padStart(2,'0')));
    return{ok:a.join()==='0,0,200,200,200'&&b.join()==='200,350,200',d:a.join()+' | '+b.join()}});
  await t('R51','Totais do rodapé da planilha batem com os lançamentos do mês',()=>{yr=+cur.slice(0,4);tab('plan');const i=+cur.slice(5,7)-1,tx=S.tx.filter(x=>x.date.slice(0,7)===cur&&x.cat!=='Caixinhas'),e=sum(tx.filter(x=>x.type==='in'),x=>x.amount),s=sum(tx.filter(x=>x.type==='out'),x=>x.amount),g=q=>brl($(q).textContent.replace(/[+]/g,''));
    return{ok:Math.abs(g('tiR'+i)-Math.round(e))<=1&&Math.abs(Math.abs(g('toR'+i))-Math.round(s))<=1,d:'entradas '+$('tiR'+i).textContent+' ('+e+'), saídas '+$('toR'+i).textContent+' ('+s+')'}});
  await t('R52','Renomear categoria leva junto lançamentos, planejado e compromissos',()=>{const n0=S.tx.filter(x=>x.cat==='Moradia').length,p0=plan('out','Moradia',cur);renameCat('out','Moradia','Casa');const n1=S.tx.filter(x=>x.cat==='Casa').length;
    return{ok:n1===n0&&near(plan('out','Casa',cur),p0)&&!S.tx.some(x=>x.cat==='Moradia')&&S.cfix.find(x=>x.id===301).c==='Casa'&&CATS.out.includes('Casa'),d:n0+' -> '+n1+', plan '+p0+' -> '+plan('out','Casa',cur)}});

  // ---------- conciliação ----------
  const csv=n=>'Data;Descrição;Valor\n'+Array.from({length:n},(_,i)=>'1'+(i%9)+'/'+cur.slice(5,7)+'/'+cur.slice(0,4)+';Compra no debito Padaria Teste '+String.fromCharCode(65+i%26)+String.fromCharCode(65+Math.floor(i/26))+';-'+(1000+i)+',37').join('\n');
  await t('R60','"Lançar sugeridas" com 150 movimentações: cada lançamento com id único e nada perdido',async()=>{const n0=S.tx.length;recImport(csv(150),'conta');tab('rec');const p=S.rec.filter(x=>x.st==='pend').length;$('rc-all').click();await wait(50);$('rc-all').click();await wait(100);
    const novos=S.tx.length-n0;let rep=0;
    for(let k=0;k<10;k++){const b=S.tx.length;for(let i=0;i<150;i++){const x={id:'z'+k+'_'+i,date:T,type:'out',amount:1+i,desc:'Padaria '+i,st:'pend',kind:'conta'};S.rec.push(x);recCommit(x,'Alimentação','Pix')}}rep=S.tx.length-new Set(S.tx.map(x=>x.id)).size;   // em sequência rápida, como no celular com muitas pendentes
    return{ok:p===150&&novos===150&&rep===0,d:p+' pendentes, '+novos+' lançadas, '+rep+' id(s) repetido(s) em 10 rodadas'}});
  await t('R61','Importar o mesmo extrato duas vezes não duplica',()=>{recImport(csv(40),'conta');const a=S.rec.length;recImport(csv(40),'conta');return{ok:S.rec.length===a,d:a+' -> '+S.rec.length}});
  await t('R62','Movimentação igual a lançamento existente vira "parece já lançado" e fica fora do "Lançar sugeridas"; fatura e transferência própria são ignoradas',()=>{const x=S.tx.find(q=>q.type==='out'&&q.date.slice(0,7)===cur&&!q.pd&&!q.cx);
    recImport('Data;Descrição;Valor\n'+brd(x.date)+';Padaria qualquer;-'+String(x.amount).replace('.',',')+'\n'+brd(T)+';Pagamento de fatura;-500,00\n'+brd(T)+';Pix enviado Fulano de Teste;-70,00','conta');const L=S.rec.slice(-3);
    return{ok:L[0].dup&&!bulkOk(L[0])&&L[1].st==='ign'&&L[2].st==='ign',d:L.map(q=>q.st+(q.dup?'/dup':'')).join(', ')}});
  await t('R63','Saída que bate com compromisso em aberto sugere o compromisso e fica fora do "Lançar sugeridas"',()=>{recImport('Data;Descrição;Valor\n'+brd(T)+';Pagamento IPVA SEFAZ;-980,55','conta');const x=S.rec[S.rec.length-1],c=cpOf(x);return{ok:!!c&&c.id===410&&!bulkOk(x),d:c?c.n:'sem sugestão'}});

  // ---------- editar, ressarcimento, backup ----------
  await t('R33','Editar a data de uma compra no cartão recalcula o vencimento da fatura',()=>{const x={id:7,type:'out',amount:50,desc:'Edita',cat:'Lazer',date:invDue(101,cur+'-10'),pd:cur+'-10',pay:'Cartão',card:101};S.tx.push(x);openEt(7);$('etd').value=cur+'-26';$('etsv').click();
    return{ok:x.date===invDue(101,cur+'-26')&&x.pd===cur+'-26',d:x.pd+' -> fatura '+x.date}});
  await t('R34','Ressarcimento abate a despesa e não vira receita',()=>{setM(cur);const x={id:8,type:'out',amount:200,desc:'Jantar',cat:'Lazer',date:T,pay:'Pix'};S.tx.push(x);render();const i0=$('inc').textContent;applyRes(x,150,T,'Amigo');render();
    return{ok:x.amount===50&&x.gross===200&&$('inc').textContent===i0,d:'ficou '+x.amount}});
  const bkFile=async()=>{let blob=null;const o=URL.createObjectURL;URL.createObjectURL=b=>{blob=b;return o.call(URL,b)};$('bk-dl').click();URL.createObjectURL=o;return blob?await blob.text():''};
  const bkText=async()=>{const c=navigator.clipboard,w=c&&c.writeText;let tx='';if(c)c.writeText=async v=>{tx=v};$('bk-cp').click();await wait(60);if(c)c.writeText=w;return tx||$('bk-txt').value};
  const volta=async(txt,nome)=>{const a={tx:S.tx.length,comp:S.comp.length,cfix:S.cfix.length,fp:Object.keys(S.fp||{}).length,cx:S.cx.length,cards:S.cards.length,ap:sum(openOf(cur,1),x=>x.v)};
    if(!txt)return nome+': backup vazio';S.tx=[];S.comp=[];S.cfix=[];S.fp={};S.cx=[];S.cards=[];S.sheet=[];radio('bm','replace');importText(txt);m=cur;
    const b={tx:S.tx.length,comp:S.comp.length,cfix:S.cfix.length,fp:Object.keys(S.fp||{}).length,cx:S.cx.length,cards:S.cards.length,ap:sum(openOf(cur,1),x=>x.v)},bad=Object.keys(a).filter(k=>a[k]!==b[k]);
    return{ok:!bad.length,d:bad.map(k=>k+' '+a[k]+' -> '+b[k]).join('; ')}};
  await t('R90','Backup em arquivo: baixar, apagar tudo e restaurar devolve o mesmo estado (lançamentos, compromissos, faturas pagas, A pagar)',async()=>volta(await bkFile(),'arquivo'));
  await t('R91','Backup em texto: copiar, apagar tudo e restaurar devolve o mesmo estado',async()=>volta(await bkText(),'texto'));
  await t('R92','Restaurar com "Juntar" duas vezes não duplica nada',async()=>{const txt=await bkFile(),a=[S.tx.length,S.comp.length,S.cfix.length,S.cx.length,S.sheet.length].join();radio('bm','merge');importText(txt);importText(txt);const b=[S.tx.length,S.comp.length,S.cfix.length,S.cx.length,S.sheet.length].join();return{ok:a===b,d:a+' -> '+b}});

  // ---------- telas e regras de design ----------
  await t('R70','Máscara de valor: dígitos entram pela direita (2590 vira 25,90), só números',()=>{tab('lan');type($('v'),'2590');const a=$('v').value;type($('v'),'12a3,4');const b=$('v').value;openForm();type($('cv'),'150000');const c=$('cv').value;return{ok:a==='25,90'&&b==='12,34'&&c==='1.500,00',d:[a,b,c].join(' | ')}});
  await t('R71','Nenhum pop-up abre com campo focado (teclado do celular não abre sozinho)',()=>{const bad=[],chk=n=>{const a=document.activeElement;if(a&&/INPUT|TEXTAREA|SELECT/.test(a.tagName))bad.push(n+' focou #'+a.id);if(a&&a.blur)a.blur();document.querySelectorAll('.mdl').forEach(e=>e.hidden=true)};
    openForm();chk('novo compromisso');openForm(fnd(410));chk('editar compromisso');openEt(S.tx.find(x=>!x.cx&&x.type==='out').id);chk('editar lançamento');openCxNew();chk('nova caixinha');openCard(null);chk('novo cartão');openLine('out');chk('nova linha');openRes(S.tx.find(x=>!x.cx&&x.type==='out').id);chk('ressarcimento');cPg=fnd(410);document.querySelector('[data-ca=pay]')&&document.querySelector('[data-ca=pay]').click();chk('marcar como pago');
    return{ok:!bad.length,d:bad.join('; ')}});
  await t('R72','Todo campo de cadastro/edição tem título fixo acima (placeholder não conta)',()=>{tab('rec');openForm();openEt(S.tx.find(x=>!x.cx&&x.type==='out').id);
    const bad=[...document.querySelectorAll('input,select,textarea')].filter(e=>!['radio','checkbox','file','hidden','month'].includes(e.type)&&!e.closest('#sh,#cats,#icats,#cxl,#au,#lk,#rll,#per')&&e.id!=='m').filter(e=>{const w=e.closest('.etf');const pv=e.previousElementSibling;return!((e.id&&document.querySelector('label[for="'+e.id+'"]'))||(w&&w.querySelector('label,small'))||(pv&&pv.tagName==='LABEL'))}).map(e=>'#'+(e.id||e.dataset.f||e.name));
    return{ok:!bad.length,d:bad.join(', ')}});
  await t('R73','Descrição com HTML aparece como texto (não vira marcação)',()=>{S.tx.push({id:5,type:'out',amount:1,desc:'<img src=x onerror=window.__x=1><b>z</b>',cat:'Outros',date:T,pay:'Pix'});setM(cur);openCat='Outros';render();tab('lan');return{ok:!$('list').querySelector('img')&&!$('cats').querySelector('img')&&!window.__x,d:''}});
  await t('R74','Toda exclusão usa a lixeira vermelha padrão',()=>{tab('plan');renderSheet();const ref=document.createElement('button');ref.className='trash';document.body.appendChild(ref);const cor=getComputedStyle(ref).color;ref.remove();
    const bad=[...document.querySelectorAll('button.del,button.trash,[data-pgdel],[data-rdel]')].filter(b=>b.offsetParent!==null||b.closest('#sh')).filter(b=>getComputedStyle(b).color!==cor||!b.querySelector('svg')).map(b=>b.className||Object.keys(b.dataset)[0]);return{ok:!bad.length,d:[...new Set(bad)].join(', ')+(bad.length?' ('+bad.length+' botões fora do padrão)':'')}});

  await t('R75','Nenhuma tela passa da largura do celular com valores grandes (sem rolagem lateral da página)',()=>{const bad=[];S.comp.push({id:499,n:'Conta grande',v:123456.78,c:'Outros',d:T,m:cur,st:'a',rep:0});S.tx.push({id:6,type:'in',amount:1234567.89,desc:'Entrada grande',cat:'Extra',date:T,pay:'Pix'});render();
    for(const tb of ['res','lan','plan','cxs','rec']){tab(tb);if(document.documentElement.scrollWidth>innerWidth+1)bad.push(tb)}tab('lan');lview(true);if(document.documentElement.scrollWidth>innerWidth+1)bad.push('compromissos');lview(false);return{ok:!bad.length,d:bad.join(', ')}});

  // ---------- ícones de informação ----------
  await t('R80','Todo ícone (i) abre um balão com texto, dentro da tela, e fecha no segundo toque',async()=>{const bad=[];for(const tb of ['res','lan','plan','cxs','rec']){tab(tb);if(tb==='lan'){radio('tp','out');radio('pg','Cartão')}document.querySelectorAll('details').forEach(d=>d.open=true);
      for(const b of document.querySelectorAll('#'+tb+' .inf')){if(b.offsetParent===null)continue;b.scrollIntoView({block:'center'});await wait(30);b.click();const tp=$('tip'),r=tp.getBoundingClientRect(),tx=tp.textContent.trim();
        if(tp.hidden||tx.length<20||/Sem informações/.test(tx))bad.push(tb+': vazio');else if(r.left<0||r.right>innerWidth+1||r.top<0||r.bottom>innerHeight+1)bad.push(tb+': fora da tela');b.click();if(!tp.hidden)bad.push(tb+': não fecha')}}
    lview(true);const cb=$('cpv').querySelector('.inf');if(!cb)bad.push('compromissos: sem ícone');lview(false);['#tape','#vcard','#ocard','#rcard','#fcard','#f','#plan','#cxs','#pgc','#seg','#nfcard','#backup'].forEach(q=>{if(!document.querySelector(q+' .inf'))bad.push(q+': sem ícone')});
    return{ok:!bad.length,d:bad.join('; ')||document.querySelectorAll('.inf').length+' ícones'}});
  await t('R81','Textos de ajuda não afirmam coisas antigas (dados só no aparelho, fatura pelo mês da compra...)',()=>{const velho=[/ficam s[óo] neste aparelho/i,/Nada sai do seu aparelho/i,/chegam sozinhas ao abrir o sistema/i,/compras feitas no cartão no mês escolhido/i],bad=[...document.querySelectorAll('.inf[data-tip]')].filter(b=>velho.some(v=>v.test(b.dataset.tip))).map(b=>b.dataset.tip.slice(0,50));return{ok:!bad.length,d:bad.join(' | ')}});

  // ---------- planilha: caixinhas editáveis e pílulas de status ----------
  const cxMes=(id,k)=>r2(S.tx.filter(x=>x.cx===id&&x.date.slice(0,7)===k).reduce((a,x)=>a+(x.type==='out'?x.amount:-x.amount),0));
  await t('R94','Real da caixinha na planilha: ajustar o total do mês cria só a diferença (guardar ou retirar) e o Real, o Sobrou e o histórico acompanham',()=>{reset();m=cur;$('m').value=cur;render();tab('plan');renderSheet();const td=document.querySelector('#sh td[data-cxr="201"][data-k="'+cur+'"]');if(!td)return'célula do Real da caixinha sem data-cxr';
    td.click();if($('cxrm').hidden)return'pop-up não abriu';const a=cxMes(201,cur),nt=S.tx.length,sb0=$('bal').textContent;
    $('cxrv').value='0,00';type($('cxrv'),'80000');$('cxrok').click();const b=cxMes(201,cur),ad=S.tx[S.tx.length-1];
    const ok1=near(b,800)&&S.tx.length===nt+1&&ad.cat==='Caixinhas'&&near(ad.amount,800-a)&&S.cx[0].mv.some(v=>v.note==='Ajuste de planilha');
    cxrOpen(201,cur);type($('cxrv'),'10000');$('cxrok').click();const c=cxMes(201,cur);
    return{ok:ok1&&near(c,100)&&$('bal').textContent!==sb0,d:'antes '+a+', depois de 800: '+b+', depois de 100: '+c+', ajuste '+ad.amount}});
  await t('R95','Excluir um movimento da caixinha pelo pop-up da planilha pede confirmação, remove o lançamento do caixa e atualiza o Real',()=>{reset();m=cur;tab('plan');renderSheet();cxrOpen(201,cur);const n=S.tx.length,mv=S.cx[0].mv.filter(v=>v.date.slice(0,7)===cur).length;if(!mv)return'sem movimento no mês';
    const b=$('cxrl').querySelector('[data-cxrdel]');if(!b||!b.querySelector('svg')||!b.classList.contains('trash'))return'lixeira fora do padrão';b.click();
    const cf=document.getElementById('cfm');if(!cf||cf.hidden)return'sem confirmação';if(S.tx.length!==n)return'excluiu sem confirmar';cf.querySelector('[data-cfm="0"]').click();
    return{ok:S.tx.length===n-1&&S.cx[0].mv.filter(v=>v.date.slice(0,7)===cur).length===mv-1,d:'lançamentos '+n+' -> '+S.tx.length}});
  await t('R96','Pílula de status no Real dos gastos: verde até 70% do Plan, laranja de 70% a 100%, vermelho acima; sem Plan não tem pílula',()=>{reset();m=cur;tab('plan');renderSheet();const bad=[];let n=0;
    document.querySelectorAll('#sh tbody tr').forEach(tr=>{const ro=tr.querySelector('td.cur.ro'),pl=tr.querySelector('td.cur.pl input');if(!ro||!pl||tr.querySelector('td[data-cxr]'))return;const cat=tr.dataset.cat;if(!cat)return;const p=Math.abs(brl(pl.value)),v=Math.abs(brl(ro.textContent)),cls=['s-ok','s-warn','s-over'].filter(c=>ro.classList.contains(c));
      const esp=!(p>0&&v>0)?'':v>p+.5?'s-over':v>=p*.7?'s-warn':'s-ok';if((cls[0]||'')!==esp)bad.push(cat+': '+(cls[0]||'nenhuma')+' x '+(esp||'nenhuma'));else if(esp)n++;if(esp&&getComputedStyle(ro,'::after').backgroundColor==='rgba(0, 0, 0, 0)')bad.push(cat+': pílula sem cor')});
    return{ok:!bad.length&&n>0,d:bad.join('; ')||n+' linhas conferidas'}});
  await t('R97','Com senha definida, o app bloqueia assim que sai da tela (a senha é pedida toda vez que abrir); sem senha não bloqueia; planilha sem sinais + e −',()=>{
    const h=document.documentElement,bk=localStorage.getItem('caixa-pin');const hide=v=>{Object.defineProperty(document,'hidden',{get:()=>v,configurable:true});document.dispatchEvent(new Event('visibilitychange'))};
    h.classList.remove('locked');localStorage.removeItem('caixa-pin');hide(true);const semSenha=h.classList.contains('locked');hide(false);
    localStorage.setItem('caixa-pin',JSON.stringify({s:'AAAA',h:'x'}));hide(true);const comSenha=h.classList.contains('locked');hide(false);
    h.classList.remove('locked');if(bk)localStorage.setItem('caixa-pin',bk);else localStorage.removeItem('caixa-pin');delete document.hidden;
    tab('plan');renderSheet();const sinais=[...document.querySelectorAll('#sh td.ro,#sh td.t,#sh td.pl input,#sh tfoot td')].filter(e=>/[+−-]/.test(e.value!==undefined?e.value:e.textContent)).length;
    return{ok:!semSenha&&comSenha&&sinais===0,d:'sem senha trava: '+semSenha+'; com senha trava: '+comSenha+'; células com sinal: '+sinais}});
  await t('R98','Desbloqueio pelo celular: com ele ativo a tela de bloqueio mostra o botão do celular e esconde a senha até tocar em "Usar a senha do app"; sem ele só a senha; remover a senha desativa o celular',()=>{
    const h=document.documentElement,bp=localStorage.getItem('caixa-pin'),bb=localStorage.getItem('caixa-bio'),vis=id=>getComputedStyle($(id)).display!=='none';
    const lim=()=>{h.classList.remove('locked','lkbio','lkpw');if(bp)localStorage.setItem('caixa-pin',bp);else localStorage.removeItem('caixa-pin');if(bb)localStorage.setItem('caixa-bio',bb);else localStorage.removeItem('caixa-bio')};
    localStorage.setItem('caixa-pin',JSON.stringify({s:'AAAA',h:'x'}));localStorage.removeItem('caixa-bio');lockNow();const a=[vis('lkbio'),vis('lkpw'),vis('lkuse')];
    h.classList.remove('locked');localStorage.setItem('caixa-bio','AAAA');lockNow();const b=[vis('lkbio'),vis('lkpw'),vis('lkuse')];$('lkuse').click();const c=[vis('lkpw'),vis('lkuse')];
    h.classList.remove('locked');$('pin-off').click();const off=!localStorage.getItem('caixa-pin')&&!localStorage.getItem('caixa-bio');lim();
    const ok=a.join()==='false,true,false'&&b.join()==='true,false,true'&&c.join()==='true,false'&&off;
    return{ok,d:'sem celular '+a+' | com celular '+b+' | após usar senha '+c+' | remover senha limpa tudo: '+off}});
  await t('R99','Receitas: botão Editar muda emoji, nome e previsto do mês (títulos fixos acima dos campos); cancelar não altera; nome repetido é recusado; título do card agora é Despesas',()=>{
    reset();m=cur;$('m').value=cur;render();const ttl=document.querySelector('#ocard h2').firstChild.textContent.trim();
    const cat=CATS.in.find(c=>S.tx.some(x=>x.type==='in'&&x.cat===c&&x.date.slice(0,7)===cur));if(!cat)return'sem receita no mês';
    const nt=S.tx.filter(x=>x.cat===cat).length,pl0=S.sheet.filter(r=>r.k==='in').length;
    document.querySelector('[data-ie=start]').click();const campos=document.querySelectorAll('#icats [data-xn]').length,sem=[...document.querySelectorAll('#icats input')].filter(i=>!(i.closest('.xf')&&i.closest('.xf').querySelector('small.fl'))).length;
    const set=(sel,v)=>{const i=document.querySelector(sel);i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}))};
    document.querySelector('[data-ie=no]').click();const cancel=!document.querySelector('#icats [data-xn]')&&CATS.in.includes(cat);
    document.querySelector('[data-ie=start]').click();const outro=CATS.in.find(c=>c!==cat);set('#icats [data-xn="'+cat+'"]',outro);document.querySelector('[data-ie=ok]').click();const dup=CATS.in.includes(cat)&&!!document.querySelector('#icats [data-xn]');
    set('#icats [data-xn="'+cat+'"]','Freela PJ');set('#icats [data-xe="'+cat+'"]','🎯');set('#icats [data-xv="'+cat+'"]','123456');document.querySelector('[data-ie=ok]').click();
    const pv=S.sheet.filter(r=>r.k==='in'&&rowCat(r)==='Freela PJ').reduce((a,r)=>a+(r.v[cur]||0),0);
    const ok=ttl==='Despesas'&&campos>=2&&sem===0&&cancel&&dup&&CATS.in.includes('Freela PJ')&&!CATS.in.includes(cat)&&S.tx.filter(x=>x.cat==='Freela PJ').length===nt&&S.emo['in|Freela PJ']==='🎯'&&near(pv,1234.56)&&!document.querySelector('#icats [data-xn]');
    return{ok,d:'título '+ttl+'; campos '+campos+'; sem título '+sem+'; cancelar ok '+cancel+'; repetido barrado '+dup+'; previsto '+pv+'; lançamentos '+nt+' -> '+S.tx.filter(x=>x.cat==='Freela PJ').length}});
  await t('R100','Planilha: cada grupo (entradas, fixos, variáveis, investimentos) termina numa linha de total destacada que bate com a soma das linhas, e o cabeçalho não traz mais o "Planejado em"',()=>{
    reset();m=cur;tab('plan');renderSheet();const nv=x=>parseFloat(String(x).replace(/\./g,'').replace(',','.'))||0,rows=[...document.querySelectorAll('#sh tbody tr')],bad=[];let acc=[],nT=0;
    rows.forEach(tr=>{if(tr.classList.contains('gsum')){nT++;const r=[...tr.querySelectorAll('td')].slice(1,-1);
        for(let i=0;i<13;i++){const tr_=nv(r[i*2].textContent),tp=nv(r[i*2+1].textContent),sr=Math.abs(acc.reduce((a,x)=>a+(x.r[i]||0),0)),sp=acc.reduce((a,x)=>a+(x.p[i]||0),0);
          if(Math.abs(tr_-sr)>acc.length||Math.abs(tp-sp)>acc.length)bad.push(tr.cells[0].textContent+' col '+i+': '+tr_+'/'+tp+' x '+sr+'/'+sp)}
        acc=[]}
      else if(tr.querySelector('td.ro')){const r=[...tr.querySelectorAll('td.ro')].map(c=>nv(c.textContent)*(c.classList.contains('cxc')&&c.classList.contains('pos')?-1:1)),p=[...tr.querySelectorAll('td.pl input')].map(c=>nv(c.value));r.push(nv(tr.querySelector('td.g.t').textContent)*(tr.querySelector('td.cxc')&&tr.querySelector('td.g.t').classList.contains('pos')?-1:1));p.push(nv(tr.querySelector('td.t:not(.g)').textContent));acc.push({r,p})}});
    const hd=document.querySelector('#sh').textContent.includes('Planejado em'),est=getComputedStyle(document.querySelector('#sh tr.gsum td')).backgroundColor;
    return{ok:nT>=3&&!bad.length&&!hd&&est!=='rgba(0, 0, 0, 0)',d:'linhas de total '+nT+'; divergências '+bad.length+(bad[0]?' ('+bad[0]+')':'')+'; texto antigo '+hd+'; fundo '+est}});
  await t('R103','Conciliação mostra só o mês do topo (lista, contadores e Lançar sugeridas); a aba ⚙ conta todas; o atalho leva ao mês com pendência',()=>{
    reset();const k0=cur,k1=addM(cur,-1),mk=(id,k,d)=>({id,st:'pend',date:k+'-'+d,desc:'Teste '+id,amount:10,type:'out',kind:'conta',cat:'Outros'});
    S.rec=[mk('p:a1',k0,'05'),mk('p:a2',k0,'06'),mk('p:b1',k1,'10'),Object.assign(mk('p:b2',k1,'11'),{st:'ign'})];setPer(k0);
    const l0=document.querySelectorAll('#rcl li[data-r]').length,nav=document.querySelector('nav [data-t=rec]').textContent,out=$('rc-out');
    const outOk=!out.hidden&&/1 pendente/.test(out.textContent);const ig0=$('rc-ig').hidden;
    $('rc-all').click();$('rc-all').click();const pb1=S.rec.find(x=>x.id==='p:b1').st;
    out.querySelector('[data-rcgo]').click();const l1=[...document.querySelectorAll('#rcl li[data-r]')].map(li=>li.dataset.r).join(),mOk=m===k1,ig1=!$('rc-ig').hidden;
    setPer(cur);
    return{ok:l0===2&&/⚙ 3/.test(nav)&&outOk&&ig0&&pb1==='pend'&&mOk&&l1==='p:b1'&&ig1,d:'mês atual '+l0+' itens; aba "'+nav+'"; outros meses: '+out.textContent+'; b1 após Lançar sugeridas: '+pb1+'; no mês anterior: '+l1}});
  await t('R104','Barra do orçado x realizado: o laranja tem a largura real do usado (209,97 de 210 fica quase cheio); a partir de 85% o saldo vai abaixo da barra, antes disso fica dentro do tracejado',()=>{
    reset();m=cur;$('m').value=cur;tab('res');const c=CATS.out[0];S.tx=S.tx.filter(x=>!(x.cat===c&&x.date.slice(0,7)===cur));
    const caso=(plano,gasto)=>{S.tx=S.tx.filter(x=>x.id!=='r104');S.tx.push({id:'r104',type:'out',amount:gasto,desc:'r104',cat:c,date:cur+'-10',pay:'Pix'});setPlan('out',c,cur,plano);render();
      const li=[...document.querySelectorAll('#cats li')].find(l=>{const b=l.querySelector('button.cn');return b&&b.dataset.d===c});if(!li)return null;
      const bb=li.querySelector('.bb').getBoundingClientRect().width,ba=li.querySelector('.ba').getBoundingClientRect().width,bd=li.querySelector('.bd'),bres=li.querySelector('.bres');
      return{f:ba/bb,bd:bd?bd.getBoundingClientRect().width:-1,bdTxt:bd?bd.textContent.trim():'',bres:bres?bres.textContent.replace(/\s+/g,' ').trim():''}};
    const a=caso(210,209.97),b=caso(1100,983.44),d=caso(300,210);if(!a||!b||!d)return'categoria não apareceu';
    const ok=a.f>.97&&a.bd<5&&/0,03/.test(a.bres)&&!a.bdTxt&&Math.abs(b.f-.894)<.03&&/116,56/.test(b.bres)&&!b.bdTxt&&d.bres===''&&/90,00/.test(d.bdTxt)&&Math.abs(d.f-.7)<.12;
    return{ok,d:'209,97/210: preenchido '+Math.round(a.f*100)+'% saldo "'+a.bres+'" | 983,44/1100: '+Math.round(b.f*100)+'% saldo "'+b.bres+'" | 210/300: '+Math.round(d.f*100)+'% tracejado "'+d.bdTxt+'"'}});
  await t('R105','Supabase: editar envia só a diferença, o snapshot só avança se o envio der certo, recarregar reconstrói o mesmo estado e a ordem das listas vale por id',async()=>{
    // banco falso em memória: apply guarda as linhas por chave primária; load devolve cada tabela ordenada como o load_all
    const M=Mapa,db={},calls=[];let falha=false;
    const aplica=p=>{M.TABELAS.forEach(tb=>{(p.upserts[tb]||[]).forEach(r=>{db[tb]=db[tb]||new Map();db[tb].set(M.PK[tb].map(k=>r[k]).join('|'),r)})});M.TABELAS.slice().reverse().forEach(tb=>{(p.deletes[tb]||[]).forEach(r=>db[tb]&&db[tb].delete(M.PK[tb].map(k=>r[k]).join('|')))})};
    window.SB={apply:async p=>{if(falha)throw new Error('offline');calls.push(p);aplica(p)},load:async()=>Object.fromEntries(M.TABELAS.map(tb=>[tb,[...(db[tb]||new Map()).values()].sort((a,b)=>M.stable(a[M.PK[tb].filter(k=>k!=='user_id')[0]])<M.stable(b[M.PK[tb].filter(k=>k!=='user_id')[0]])?-1:1)]))};
    const bakUSE=USE_SB,bakCu=cu,bakSnap=sbSnap,bakLO=localOnly;
    try{
      USE_SB=true;cu={uid:'u-teste',email:'t@t'};sbSnap={};localOnly=false;
      await sendSB();const n0=calls[0]&&Object.values(calls[0].upserts).reduce((a,l)=>a+l.length,0);   // carga inicial: tudo sobe
      const antes=S.tx.length,id=S.tx[0].id;
      S.tx[0].amount=Math.round((S.tx[0].amount+1)*100)/100;await sendSB();
      const c1=calls[1],soUma=c1&&c1.upserts.transactions&&c1.upserts.transactions.length===1&&Object.values(c1.upserts).reduce((a,l)=>a+l.length,0)===1&&!Object.values(c1.deletes).some(l=>l.length);
      const nc=calls.length;await sendSB();const semMudanca=calls.length===nc;   // nada mudou: nada é enviado
      falha=true;S.tx.pop();let erro=false;try{await sendSB()}catch(e){erro=true}
      const pend=isDirty();falha=false;await sendSB();const ok2=!isDirty()&&calls[calls.length-1].deletes.transactions.length===1;   // falhou: continua pendente; depois vai
      const esperado=canon(Object.assign(blankS(),M.fromRows(M.toRows(core()).tables)));   // o banco guarda 2 casas: 5,6899999 vira 5,69
      S=Object.assign(blankS(),M.fromRows(await SB.load()));const volta=canon(S)===esperado;   // recarregar reproduz o estado
      const ids=S.tx.map(x=>x.id),ordem=ids.every((x,i)=>!i||ids[i-1]<x);
      const ok=n0>100&&soUma&&semMudanca&&erro&&pend&&ok2&&volta&&ordem&&S.tx.length===antes-1;
      return{ok,d:'carga '+n0+' linhas; edição=1 linha:'+soUma+'; sem mudança=0 envios:'+semMudanca+'; falha mantém pendente:'+(erro&&pend)+'; reenvio apaga 1:'+ok2+'; recarga igual:'+volta+'; ordem por id:'+ordem}
    }finally{USE_SB=bakUSE;cu=bakCu;sbSnap=bakSnap;localOnly=bakLO;delete window.SB}});
  return R;
})()
