(function(){
  var qas=[].slice.call(document.querySelectorAll('.qa')),groups=[].slice.call(document.querySelectorAll('.fq-group')),
      st={c:'all',q:''},none=document.getElementById('fnone');
  function toggle(qa,open){var b=qa.querySelector('button');qa.classList.toggle('open',open);b.setAttribute('aria-expanded',String(open))}
  qas.forEach(function(qa){qa.querySelector('button').addEventListener('click',function(){
    var open=!qa.classList.contains('open');
    qas.forEach(function(o){if(o!==qa)toggle(o,false)});toggle(qa,open)})});
  function apply(){
    var shown=0;
    groups.forEach(function(g){
      var okC=st.c==='all'||g.id===st.c,any=false;
      [].forEach.call(g.querySelectorAll('.qa'),function(qa){
        var ok=okC&&(!st.q||qa.textContent.toLowerCase().indexOf(st.q)>-1);qa.hidden=!ok;if(ok){any=true;shown++}});
      g.hidden=!any});
    none.hidden=shown>0;
    [].forEach.call(document.querySelectorAll('#cats .tab'),function(b){b.setAttribute('aria-pressed',String(b.dataset.c===st.c))});
  }
  [].forEach.call(document.querySelectorAll('#cats .tab'),function(b){b.addEventListener('click',function(){st.c=b.dataset.c;apply()})});
  document.getElementById('fq').addEventListener('input',function(e){st.q=e.target.value.trim().toLowerCase();apply()});
  var h=location.hash.slice(1);
  if(h){var g=document.getElementById(h);if(g&&g.classList.contains('fq-group')){var f=g.querySelector('.qa');if(f)toggle(f,true)}}
})();
