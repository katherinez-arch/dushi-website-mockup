(function(){
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* header + reveal al hacer scroll */
  var hdr=document.querySelector('header');
  function onS(){hdr.classList.toggle('stuck',window.scrollY>40)}
  window.addEventListener('scroll',onS,{passive:true});onS();
  var groups=['.head','.toolbar','.plan','.step','.slot','.card','.camp .wrap>*','.ali .cta','footer .fgrid>div','.v3','.callout','.qa','.fq-cta','.draft','.tzs .wrap>*','.nm .wrap>*','.band .wrap>*','.ali .head'];
  var els=[];
  groups.forEach(function(sel){var prev=null,idx=0;document.querySelectorAll(sel).forEach(function(el){
    var par=el.parentNode;if(par!==prev){prev=par;idx=0}
    el.classList.add('rv');el.style.setProperty('--i',Math.min(idx++,7));els.push(el)})});
  if('IntersectionObserver' in window&&!reduce){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){var el=e.target;el.classList.add('in');io.unobserve(el);if(!el.classList.contains('head'))el.addEventListener('transitionend',function h(ev){if(ev.propertyName==='transform'){el.classList.remove('rv','in');el.style.removeProperty('--i');el.removeEventListener('transitionend',h)}})}})},{threshold:.12,rootMargin:'0px 0px -6% 0px'});
    els.forEach(function(el){io.observe(el)});
  }else els.forEach(function(el){el.classList.add('in')});
})();