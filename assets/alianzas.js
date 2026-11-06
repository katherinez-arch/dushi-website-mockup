(function(){
  var dlg=document.getElementById('dlg'),form=document.getElementById('aliForm'),ok=document.getElementById('ok'),opener=document.getElementById('openForm');
  var msgs={'f-nombre':'Escribe el nombre de tu negocio.','f-pais':'Dinos en qué país está.','f-tipo':'Elige el tipo de negocio.','f-tel':'Escribe un teléfono válido, con al menos 7 números.','f-mail':'Escribe un correo válido, como nombre@correo.com.'};
  function open(){form.hidden=false;ok.hidden=true;dlg.showModal();setTimeout(function(){document.getElementById('f-nombre').focus()},50)}
  function close(){dlg.close()}
  opener.addEventListener('click',open);
  document.getElementById('closeForm').addEventListener('click',close);
  document.getElementById('okClose').addEventListener('click',close);
  dlg.addEventListener('click',function(e){if(e.target===dlg)close()});
  dlg.addEventListener('close',function(){opener.focus()});
  function check(el){
    var err=form.querySelector('.err[data-for="'+el.id+'"]'),bad=!el.checkValidity()||!el.value.trim();
    el.setAttribute('aria-invalid',String(bad));err.textContent=bad?msgs[el.id]:'';
    if(bad)el.setAttribute('aria-describedby','e-'+el.id),err.id='e-'+el.id;
    return !bad}
  [].forEach.call(form.querySelectorAll('input,select'),function(el){
    el.addEventListener('blur',function(){if(el.value||el.getAttribute('aria-invalid')==='true')check(el)});
    el.addEventListener('input',function(){if(el.getAttribute('aria-invalid')==='true')check(el)})});
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var first=null;[].forEach.call(form.querySelectorAll('input,select'),function(el){if(!check(el)&&!first)first=el});
    if(first){first.focus();return}
    document.getElementById('okName').textContent=document.getElementById('f-nombre').value.trim();
    /* Mockup: aquí se enviarían los datos (por ejemplo a GoHighLevel). Por ahora no se guarda nada. */
    form.reset();form.hidden=true;ok.hidden=false;
    [].forEach.call(form.querySelectorAll('[aria-invalid]'),function(x){x.removeAttribute('aria-invalid')});
  });
})();
