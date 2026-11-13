// Dados fictícios em volume para tools/regressao.js (roda dentro do app). Uma expressão só. Nada aqui é dado real.
// Sorteio com semente fixa: o resultado é sempre o mesmo, para a falha de hoje ser repetível amanhã.
(()=>{
  let s=20261113;const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648,ri=(a,b)=>a+Math.floor(rnd()*(b-a+1)),pick=a=>a[Math.floor(rnd()*a.length)],p2=n=>String(n).padStart(2,'0');
  const T=today(),cur=T.slice(0,7);
  Object.assign(S,{tx:[],sheet:[],rec:[],rules:{},cx:[],cards:[],comp:[],cfix:[],fp:{},emo:{'Pets':'🐶','in|Salário':'💼'},bud:{},budm:{},myname:'Fulano de Teste',
    cats:{out:['Moradia','Alimentação','Transporte','Saúde','Lazer','Educação','Pets','Assinaturas','Outros'],in:['Salário','Freelance','Extra','Outros']},ord:{fx:['Moradia','Assinaturas','Educação'],vr:[]}});
  syncCats();
  // cartões: vencimento antes do fechamento, depois do fechamento, e um sem regras
  S.cards.push({id:101,name:'Roxo',cl:25,dd:5,col:'#8B5CF6'},{id:102,name:'Laranja',cl:3,dd:10,col:'#F97316'},{id:103,name:'Sem regra'});
  const DESC={Moradia:['Aluguel','Condomínio','Energia Enel','Internet Vivo'],Alimentação:['Mercado Bom Preço','Padaria Central','iFood','Restaurante da Vila','Açougue'],Transporte:['Uber','Posto Shell','Estacionamento','Metrô'],Saúde:['Farmácia','Consulta','Laboratório'],Lazer:['Cinema','Netflix','Show','Bar do Zé'],Educação:['Curso Alura','Livraria'],Pets:['Ração','Veterinário'],Assinaturas:['Spotify','Nuvem','Jornal'],Outros:['Presente','Diversos <b>x</b> & "y"']};
  let id=1e12;const nid=()=>++id;
  // 14 meses: do ano passado até janeiro do ano que vem
  for(let k=addM(cur,-11);k<=addM(cur,2);k=addM(k,1)){
    const dm=new Date(+k.slice(0,4),+k.slice(5,7),0).getDate();
    S.tx.push({id:nid(),type:'in',amount:6500,desc:'Salário',cat:'Salário',date:k+'-05',pay:'Pix'});
    if(rnd()<.6)S.tx.push({id:nid(),type:'in',amount:ri(200,1800)+ri(0,99)/100,desc:'Projeto site',cat:'Freelance',date:k+'-'+p2(ri(1,dm)),pay:'Pix'});
    for(let i=0;i<110;i++){
      const c=pick(Object.keys(DESC)),pay=pick(['Pix','Pix','Dinheiro','Cartão','Cartão','Cartão']),d=k+'-'+p2(ri(1,dm)),amt=ri(5,110)+ri(0,99)/100,t={id:nid(),type:'out',amount:amt,desc:pick(DESC[c]),cat:c,pay};
      if(pay==='Cartão'){t.card=pick([101,102,103]);const du=invDue(t.card,d);t.date=du;if(du!==d)t.pd=d}else t.date=d;
      S.tx.push(t)}
  }
  // planejado: todas as categorias, o ano inteiro
  const yr0=+cur.slice(0,4);
  [['out','Moradia',2500],['out','Alimentação',1500],['out','Transporte',600],['out','Saúde',300],['out','Lazer',400],['out','Assinaturas',120],['in','Salário',6500],['in','Freelance',1000]].forEach(([kd,c,v])=>setPlan(kd,c,yr0+'-01',v));
  // caixinhas com depósitos e retiradas
  S.cx.push({id:201,name:'Viagem',target:8000,mv:[],emo:'✈️'},{id:202,name:'Reserva',target:20000,mv:[]},{id:203,name:'Vazia',target:0,mv:[]});
  for(let i=0;i<10;i++){cxMove(S.cx[0],300,addM(cur,-i)+'-06','Guardar: Viagem','Pix',true);cxMove(S.cx[1],500,addM(cur,-i)+'-07','Guardar: Reserva','Pix',true)}
  cxMove(S.cx[1],1200,cur+'-02','Retirar: Reserva','Pix',false);
  setPlan('cx','201',yr0+'-01',300);
  // compromissos: recorrentes (dia 5, dia 31, sem dia), avulsos, parcelado, pago, ignorado, atrasado
  S.cfix.push({id:301,n:'Aluguel',v:1800,c:'Moradia',day:5,from:addM(cur,-3)},{id:302,n:'Internet',v:120,c:'Moradia',day:31,from:addM(cur,-3)},{id:303,n:'Academia',v:99.9,c:'Saúde',day:0,from:cur},{id:304,n:'Encerrado',v:50,c:'Outros',day:10,from:addM(cur,-6),to:addM(cur,-4)});
  for(let i=0;i<6;i++)S.comp.push({id:400+i,n:'Notebook ('+(i+1)+'/6)',v:450,c:'Outros',d:addM(cur,i-2)+'-15',m:addM(cur,i-2),st:'a',rep:0});
  S.comp.push({id:410,n:'IPVA',v:980.55,c:'Transporte',d:cur+'-28',m:cur,st:'a',rep:0},{id:411,n:'Dentista',v:250,c:'Saúde',d:addM(cur,-1)+'-20',m:addM(cur,-1),st:'i',rep:0},{id:412,n:'Vence hoje',v:10,c:'Outros',d:T,m:cur,st:'a',rep:0});
  const pg={id:nid(),type:'out',amount:1800,desc:'Aluguel',cat:'Moradia',date:addM(cur,-1)+'-05'};S.tx.push(pg);
  S.comp.push({id:413,n:'Aluguel',v:1800,c:'Moradia',d:addM(cur,-1)+'-05',m:addM(cur,-1),st:'g',rep:301,tx:pg.id,pv:1800});
  S.fp['101|'+addM(cur,-1)]={d:T,v:1};
  S.ts=Date.now();localStorage.setItem('caixa-v1',JSON.stringify(S));
  return S.tx.length+' lançamentos, '+S.comp.length+' compromissos, '+S.cx.length+' caixinhas, '+S.cards.length+' cartões';
})()
