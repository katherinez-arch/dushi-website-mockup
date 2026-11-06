(function(){
  var count=0,cEl=document.getElementById('count'),toast=document.getElementById('toast'),tt;
  function bump(){var bd=document.querySelector('.badge');bd.classList.remove('bump');void bd.offsetWidth;bd.classList.add('bump')}
  function fly(b){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||!b.animate)return;
    var cart=document.querySelector('.badge').getBoundingClientRect(),r=b.getBoundingClientRect(),d=document.createElement('div');
    d.className='fly';document.body.appendChild(d);
    var x0=r.left+r.width/2,y0=r.top+r.height/2,x1=cart.left+cart.width/2,y1=cart.top+cart.height/2;
    var a=d.animate([{transform:'translate('+x0+'px,'+y0+'px) scale(1)',opacity:1},{transform:'translate('+(x0+(x1-x0)*.5)+'px,'+(Math.min(y0,y1)-60)+'px) scale(1.2)',opacity:1,offset:.5},{transform:'translate('+x1+'px,'+y1+'px) scale(.3)',opacity:.4}],{duration:700,easing:'cubic-bezier(.4,0,.2,1)'});
    a.onfinish=function(){d.remove()};
  }
  function say(m){toast.textContent=m;toast.classList.add('show');clearTimeout(tt);tt=setTimeout(function(){toast.classList.remove('show')},2200)}
  function bindAdd(b){b.addEventListener('click',function(){
    count++;cEl.textContent=count;b.classList.add('done');bump();fly(b);b.textContent='Agregado ✓';
    say('Agregaste '+b.closest('.card').querySelector('h3').textContent+' al carrito');
    setTimeout(function(){b.classList.remove('done');b.textContent=b.disabled?'Agotado':'Agregar'},1600)})}
  document.querySelectorAll('.add').forEach(bindAdd);
  function bindFav(b){b.addEventListener('click',function(){
    var on=b.getAttribute('aria-pressed')==='true';b.setAttribute('aria-pressed',String(!on));b.classList.remove('beat');void b.offsetWidth;if(!on)b.classList.add('beat')})}
  document.querySelectorAll('.fav').forEach(bindFav);

  /* filtros: género x plan x búsqueda x orden */
  var grid=document.getElementById('grid'),cards=[].slice.call(grid.querySelectorAll('.card')),
      st={g:'all',p:'all',q:'',s:'rel'},cnt=document.getElementById('cnt');
  var orderIdx=cards.map(function(c,i){c.dataset.i=i;return c});
  function pressed(sel,attr,val){document.querySelectorAll(sel).forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset[attr]===val))})}
  function apply(){
    var n=0;
    cards.forEach(function(c){
      var gs=c.dataset.g.split(' '),ps=c.dataset.c.split(' ');
      var okG=st.g==='all'||gs.indexOf('all')>-1||gs.indexOf(st.g)>-1;
      var okP=st.p==='all'||ps.indexOf(st.p)>-1;
      var okQ=!st.q||c.textContent.toLowerCase().indexOf(st.q)>-1;
      c.hidden=!(okG&&okP&&okQ);if(!c.hidden)n++;});
    var sorted=cards.slice().sort(function(a,b){
      if(st.s==='asc')return a.dataset.pr-b.dataset.pr;
      if(st.s==='desc')return b.dataset.pr-a.dataset.pr;
      return a.dataset.i-b.dataset.i});
    sorted.forEach(function(c){grid.appendChild(c)});
    cnt.textContent=n+(n===1?' producto':' productos');
    if(window.__f){var k=0;cards.forEach(function(c){c.classList.remove('pop');if(!c.hidden){c.style.setProperty('--i',k++);void c.offsetWidth;c.classList.add('pop')}})}
    var e=document.getElementById('emp');
    if(!n&&!e){e=document.createElement('p');e.id='emp';e.className='empty';e.textContent='No encontramos nada con esos filtros. Prueba con otro plan o género.';grid.after(e)}
    if(n&&e)e.remove();
    pressed('#gen button','g',st.g);pressed('#gchips button','g',st.g);
    pressed('#plansnav button','p',st.p);pressed('.tabs .tab','p',st.p);
  }
  document.querySelectorAll('[data-g]').forEach(function(b){b.addEventListener('click',function(){st.g=b.dataset.g;apply();if(b.closest('#gen'))document.getElementById('productos').scrollIntoView({behavior:'smooth'})})});
  document.querySelectorAll('.tabs [data-p],#plansnav [data-p]').forEach(function(b){b.addEventListener('click',function(){
    st.p=(st.p===b.dataset.p&&b.closest('#plansnav'))?'all':b.dataset.p;apply();
    if(b.closest('#plansnav'))document.getElementById('productos').scrollIntoView({behavior:'smooth'})})});
  document.querySelectorAll('[data-go]').forEach(function(a){a.addEventListener('click',function(){st.p=a.dataset.go;apply()})});
  document.getElementById('q').addEventListener('input',function(e){st.q=e.target.value.trim().toLowerCase();apply()});
  document.getElementById('sort').addEventListener('change',function(e){st.s=e.target.value;apply()});
  (function(){var u=new URLSearchParams(location.search);
    if(u.get('g'))st.g=u.get('g');if(u.get('p'))st.p=u.get('p');
    if(u.get('q')){st.q=u.get('q').toLowerCase();document.getElementById('q').value=u.get('q')}})();
  apply();window.__f=true;

  /* ===== catálogo e inventario en vivo (backend -> VELARIS) ===== */
  function esc(t){return String(t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(n){return '$'+Number(n).toFixed(2)}
  var HEART='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>';
  function cardHTML(p){
    var art=p.imagen?'<img src="'+esc(p.imagen)+'" alt="'+esc(p.nombre)+'" loading="lazy">':((window.DUSHI_ART&&window.DUSHI_ART[p.sku])||'');
    var tag=p.etiqueta?'<span class="tag'+(p.etiquetaSol?' sol':'')+'">'+esc(p.etiqueta)+'</span>':'';
    var old=p.precioAnterior&&p.precioAnterior>p.precio?'<s>'+money(p.precioAnterior)+'</s>':'';
    var sizes=p.tallas&&p.tallas.length?'<span class="sizes">Tallas '+p.tallas.map(esc).join(' · ')+'</span>':'';
    return '<article class="card" data-sku="'+esc(p.sku)+'" data-c="'+esc((p.planes||[]).join(' '))+'" data-g="'+esc((p.generos||['all']).join(' '))+'" data-pr="'+p.precio+'">'
      +'<div class="thumb" style="background:'+esc(p.bg)+'">'+art+tag+'<button class="fav" aria-pressed="false" aria-label="Guardar '+esc(p.nombre)+'">'+HEART+'</button></div>'
      +'<div class="meta"><span class="brand">'+esc(p.marca)+'</span><h3>'+esc(p.nombre)+'</h3>'+sizes
      +'<div class="row"><span class="price">'+money(p.precio)+old+'</span><button class="add">Agregar</button></div></div></article>';
  }
  function setStock(card,n){
    var meta=card.querySelector('.meta'),old=meta.querySelector('.stock'),add=card.querySelector('.add');
    if(old)old.remove();
    card.classList.toggle('soldout',n===0);
    if(n===0||n<=3){var sp=document.createElement('span');sp.className='stock'+(n===0?' out':' low');sp.textContent=n===0?'Agotado por ahora':'Quedan '+n;meta.querySelector('h3').after(sp)}
    add.disabled=n===0;if(!add.classList.contains('done'))add.textContent=n===0?'Agotado':'Agregar';
  }
  function mostrarVivo(){var l=document.getElementById('live');if(l)l.hidden=false}
  function renderCatalogo(data){
    var list=data.productos||[];if(!list.length)return;
    grid.innerHTML=list.map(cardHTML).join('');
    cards=[].slice.call(grid.querySelectorAll('.card'));
    cards.forEach(function(c,i){c.dataset.i=i;bindAdd(c.querySelector('.add'));bindFav(c.querySelector('.fav'));setStock(c,list[i].disponible)});
    mostrarVivo();apply();
  }
  function actualizarStock(){
    fetch('/api/stock',{cache:'no-store'}).then(function(r){return r.ok?r.json():Promise.reject()}).then(function(d){
      cards.forEach(function(c){var s=d.stock[c.dataset.sku];if(s)setStock(c,s.disponible)});mostrarVivo()}).catch(function(){});
  }
  fetch('/api/catalogo').then(function(r){return r.ok?r.json():Promise.reject()}).then(function(d){
    renderCatalogo(d);setInterval(actualizarStock,30000)}).catch(function(){/* sin backend: se queda el catálogo de ejemplo */});

  /* carrusel */
  var track=document.getElementById('track'),slides=track.children,N=slides.length,i=0,timer,playing=true,
      dots=document.getElementById('dots'),vid=document.getElementById('vid'),pp=document.getElementById('pp'),
      reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches,DUR=[9,6,6,6];
  for(var k=0;k<N;k++){(function(k){var d=document.createElement('button');d.className='dot';d.setAttribute('aria-label','Ir a la diapositiva '+(k+1));
    d.addEventListener('click',function(){go(k)});dots.appendChild(d)})(k)}
  function go(n){
    i=(n+N)%N;track.style.transform='translateX('+(-100*i)+'%)';
    [].forEach.call(dots.children,function(d,j){d.setAttribute('aria-current',String(j===i));d.style.setProperty('--dur',DUR[j]+'s');d.classList.remove('paused');void d.offsetWidth;d.classList.toggle('paused',!playing)});
    [].forEach.call(slides,function(s,j){s.classList.toggle('on',j===i);s.setAttribute('aria-hidden',String(j!==i));[].forEach.call(s.querySelectorAll('a,button'),function(x){x.tabIndex=j===i?0:-1})});
    if(vid){if(i===0&&playing&&!reduce){var p=vid.play();if(p&&p.catch)p.catch(function(){})}else vid.pause()}
    clearTimeout(timer);if(playing&&!reduce)timer=setTimeout(function(){go(i+1)},DUR[i]*1000);
  }
  function setPlay(v){playing=v;pp.setAttribute('aria-label',v?'Pausar carrusel':'Reanudar carrusel');
    pp.innerHTML=v?'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>':'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';go(i)}
  pp.addEventListener('click',function(){setPlay(!playing)});
  document.getElementById('prev').addEventListener('click',function(){go(i-1)});
  document.getElementById('next').addEventListener('click',function(){go(i+1)});
  var car=document.getElementById('car');
  car.addEventListener('keydown',function(e){if(e.key==='ArrowLeft')go(i-1);if(e.key==='ArrowRight')go(i+1)});
  [].forEach.call(slides,function(s){[].forEach.call(s.querySelectorAll('.wrap>div:first-child>*'),function(el,k){el.style.setProperty('--k',k)})});
  if(reduce){playing=false;setPlay(false)}else go(0);
})();
