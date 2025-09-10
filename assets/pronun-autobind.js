<!-- /assets/pronun-autobind.js -->
<script>
(function(){
  function getRef(el){ return el.getAttribute('data-ref')||''; }
  function mountOne(card){
    window.Pronun?.mount(card,{
      getReferenceText: getRef,
      onResult: (r)=> card.dataset.pronAcc = Math.round((r.accuracy||0)*100)
    });
  }
  function init(){
    document.querySelectorAll('.pronun-card[data-ref]').forEach(mountOne);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
</script>
