<template>
  <div
    v-if="!clientRequest"
    class="flex flex-col w-full min-h-screen bg-zinc-900"
  >
    <LazyUserHeader class="z-50" hydrate-on-idle />
    <div class="grow flex">
      <NuxtPage />
    </div>
    <LazyUserFooter class="z-50" hydrate-on-interaction />
    <AchievementToast />
  </div>
  <div v-else class="flex flex-col w-full min-h-screen bg-zinc-900">
    <NuxtPage />
    <LazyUserHeaderStoreNav />
  </div>
</template>

<script setup lang="ts">
const clientRequest = isClientRequest();
const i18nHead = useLocaleHead();

const { t } = useI18n();

useHead({
  htmlAttrs: {
    lang: i18nHead.value.htmlAttrs.lang,
    // @ts-expect-error head.value.htmlAttrs.dir is not typed as strictly as it should be
    dir: i18nHead.value.htmlAttrs.dir,
  },
  // // seo headers
  // link: [...i18nHead.value.link],
  // meta: [...i18nHead.value.meta],
  titleTemplate(title) {
    return title ? t("titleTemplate", [title]) : t("title");
  },
  // Inject Big Picture controller bridge when embedded in the desktop client.
  // This listens for postMessage events from the Tauri shell and translates
  // gamepad D-pad / A / B into spatial focus navigation inside the iframe.
  ...(clientRequest
    ? {
        script: [
          {
            key: "controller-bridge",
            innerHTML: `(function(){
  "use strict";
  var FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var FOCUS_CLASS="bp-iframe-focused";
  var style=document.createElement("style");
  style.textContent="."+FOCUS_CLASS+"{outline:none!important;box-shadow:0 0 0 3px rgba(59,130,246,0.8),0 0 16px rgba(59,130,246,0.25)!important;position:relative;z-index:9999}";
  document.head.appendChild(style);
  var currentFocused=null;
  function getFocusable(){return Array.from(document.querySelectorAll(FOCUSABLE)).filter(function(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0})}
  function getCenter(e){var r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}}
  function setFocus(e){if(currentFocused)currentFocused.classList.remove(FOCUS_CLASS);currentFocused=e;if(e){e.classList.add(FOCUS_CLASS);e.scrollIntoView({block:"nearest",behavior:"smooth"})}}
  function navigate(d){var els=getFocusable();if(!els.length)return;if(!currentFocused||!document.body.contains(currentFocused)){setFocus(els[0]);return}var from=getCenter(currentFocused);var best=null,bestS=Infinity;for(var i=0;i<els.length;i++){var el=els[i];if(el===currentFocused)continue;var to=getCenter(el);var dx=to.x-from.x,dy=to.y-from.y;var ok=(d==="up"&&dy<-10)||(d==="down"&&dy>10)||(d==="left"&&dx<-10)||(d==="right"&&dx>10);if(!ok)continue;var p=(d==="up"||d==="down")?Math.abs(dy):Math.abs(dx);var s=(d==="up"||d==="down")?Math.abs(dx):Math.abs(dy);var sc=p+s*2;if(sc<bestS){bestS=sc;best=el}}if(best)setFocus(best)}
  window.addEventListener("message",function(ev){if(!ev.data||ev.data.type!=="bp-controller")return;var a=ev.data.action;if(a==="navigate")navigate(ev.data.direction);else if(a==="select"){if(currentFocused){currentFocused.click();if(currentFocused.tagName==="INPUT"||currentFocused.tagName==="TEXTAREA"||currentFocused.tagName==="SELECT")currentFocused.focus()}}else if(a==="back")window.history.back();else if(a==="scroll")window.scrollBy(0,ev.data.amount||0)});
  try{window.parent.postMessage({type:"bp-bridge-ready"},"*")}catch(e){}
})();`,
          },
        ],
      }
    : {}),
});
const { mLogoObjectId } = await $dropFetch("/api/v1");
const favicon = mLogoObjectId ? useObject(mLogoObjectId) : "/favicon.ico";
useFavicon(favicon, { rel: "icon" });
</script>
