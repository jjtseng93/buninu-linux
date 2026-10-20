// Kitty keyboard transport for the shipped xterm wrapper (no build step).
// Spec: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
(function (root) {
  'use strict';
  // Supported progressive enhancements: disambiguation, event types, all keys.
  // Do not advertise alternate-layout/text reporting until those are implemented.
  const SUPPORTED = 1 | 2 | 8;
  const functional = {
    Escape:[27,'u'], Enter:[13,'u'], Tab:[9,'u'], Backspace:[127,'u'],
    Insert:[2,'~'], Delete:[3,'~'], ArrowLeft:[1,'D'], ArrowRight:[1,'C'],
    ArrowUp:[1,'A'], ArrowDown:[1,'B'], PageUp:[5,'~'], PageDown:[6,'~'],
    Home:[1,'H'], End:[1,'F'], CapsLock:[57358,'u'], ScrollLock:[57359,'u'],
    NumLock:[57360,'u'], PrintScreen:[57361,'u'], Pause:[57362,'u'], ContextMenu:[57363,'u'],
    MediaPlay:[57428,'u'], MediaPause:[57429,'u'], MediaPlayPause:[57430,'u'],
    MediaStop:[57432,'u'], MediaFastForward:[57433,'u'], MediaRewind:[57434,'u'],
    MediaTrackNext:[57435,'u'], MediaTrackPrevious:[57436,'u'], MediaRecord:[57437,'u'],
    AudioVolumeDown:[57438,'u'], AudioVolumeUp:[57439,'u'], AudioVolumeMute:[57440,'u'],
  };
  [11,12,13,14,15,17,18,19,20,21,23,24].forEach((n,i) => functional['F'+(i+1)] = [n,'~']);
  for (let i=13;i<=35;i++) functional['F'+i] = [57376+i-13,'u'];
  const punctuation = {
    Backquote:['`','~'], Minus:['-','_'], Equal:['=','+'], BracketLeft:['[','{'],
    BracketRight:[']','}'], Backslash:['\\','|'], Semicolon:[';',':'], Quote:["'",'"'],
    Comma:[',','<'], Period:['.','>'], Slash:['/','?'], Space:[' ',' '],
  };
  const modifiers = {Shift:[1,57441], Control:[4,57442], Alt:[2,57443], Meta:[8,57444],
    OS:[8,57444], Super:[8,57444], Hyper:[16,57445], AltGraph:[0,57453]};
  const has = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
  const lock = (e,name) => Boolean(e.getModifierState?.(name));
  function physicalCode(e) {
    if (e.code && e.code !== 'Unidentified') return e.code;
    if (e.keyCode>=65 && e.keyCode<=90) return 'Key'+String.fromCharCode(e.keyCode);
    if (e.keyCode>=48 && e.keyCode<=57) return 'Digit'+String.fromCharCode(e.keyCode);
    return ({32:'Space',186:'Semicolon',187:'Equal',188:'Comma',189:'Minus',190:'Period',
      191:'Slash',192:'Backquote',219:'BracketLeft',220:'Backslash',221:'BracketRight',222:'Quote'})[e.keyCode] || '';
  }
  function baseCharacter(e, android) {
    const code=physicalCode(e);
    // Android's Alt accent conversion must not turn an E/I/N/U shortcut into a dead key.
    const recover=android && e.altKey && !lock(e,'AltGraph');
    if (recover || ([...e.key || ''].length===1 && e.key.codePointAt(0)<32)) {
      if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
      if (/^Digit[0-9]$/.test(code)) return code.slice(5);
      if (has(punctuation,code)) return punctuation[code][0];
    }
    if ([...e.key || ''].length!==1) return null;
    if (e.shiftKey) {
      if (has(punctuation,code) && punctuation[code][1]===e.key) return punctuation[code][0];
      if (/^Digit[0-9]$/.test(code) && ')!@#$%^&*('[Number(code.slice(5))]===e.key) return code.slice(5);
    }
    const lower=e.key.toLowerCase();
    return [...lower].length===1 ? lower : e.key;
  }
  function keyDefinition(e, flags, android) {
    if (has(modifiers,e.key)) {
      const [bit,left]=modifiers[e.key];
      const right=e.location===2 || /Right$/.test(e.code || '');
      return {number:left+(right && e.key!=='AltGraph'?6:0),suffix:'u',modifier:bit};
    }
    if ((flags & 9) && (e.location===3 || /^Numpad/.test(e.code || ''))) {
      const numpad={NumpadDecimal:57409,NumpadDivide:57410,NumpadMultiply:57411,
        NumpadSubtract:57412,NumpadAdd:57413,NumpadEnter:57414,NumpadEqual:57415,
        NumpadComma:57416};
      const nav={ArrowLeft:57417,ArrowRight:57418,ArrowUp:57419,ArrowDown:57420,
        PageUp:57421,PageDown:57422,Home:57423,End:57424,Insert:57425,Delete:57426,Clear:57427};
      const number=has(nav,e.key)?nav[e.key]:/^Numpad[0-9]$/.test(e.code || '')
        ?57399+Number(e.code.slice(6)):numpad[e.code];
      if (number) return {number,suffix:'u'};
    }
    if (has(functional,e.key)) {
      const [number,suffix]=functional[e.key];
      return {number,suffix,recovery:['Enter','Tab','Backspace'].includes(e.key)};
    }
    const ch=baseCharacter(e,android);
    return ch===null?null:{number:ch.codePointAt(0),suffix:'u',text:true};
  }
  class KittyKeyboard {
    constructor(term, {android=false}={}) {
      this.term=term; this.android=android; this.disposables=[];
      this.metaKeys=new Set(); this.down=new Map(); this.suppressed=new Set(); this.reset();
      const register=(prefix,fn) => this.disposables.push(term.parser.registerCsiHandler({prefix,final:'u'},p=>{fn(p);return true;}));
      const value=(p,i,fallback=0) => Number.isInteger(p[i])?p[i]:fallback;
      register('?',()=>term.input(`\x1b[?${this.flags}u`,false));
      register('>',p=>{const s=this.state;s.stack.push(s.flags);if(s.stack.length>32)s.stack.shift();s.flags=value(p,0)&SUPPORTED;});
      register('<',p=>{const s=this.state;let count=Math.min(value(p,0)||1,33);while(count--)s.flags=s.stack.pop()??0;});
      register('=',p=>{const s=this.state,f=value(p,0)&SUPPORTED,m=value(p,1)||1;if(m===1)s.flags=f;else if(m===2)s.flags|=f;else if(m===3)s.flags&=~f;});
      this.disposables.push(term.parser.registerEscHandler({final:'c'},()=>{this.reset();return false;}));
      this.disposables.push(term.parser.registerCsiHandler({intermediates:'!',final:'p'},()=>{this.reset();return false;}));
    }
    get state() { return this.states[this.term.buffer.active.type==='alternate'?'alternate':'normal']; }
    get flags() { return this.state.flags; }
    reset() {
      this.states={normal:{flags:0,stack:[]},alternate:{flags:0,stack:[]}};
      this.clearHeld(false);
    }
    clearHeld(report=true) {
      // Release keys reported to the client before losing focus, avoiding stuck remote keys.
      if (report && (this.flags & 2)) for (const key of this.down.values()) {
        if(key.reported) this.term.input(this.sequence(key.def,0,3),true);
      }
      this.metaKeys.clear();this.down.clear();this.suppressed.clear();this.suppressKeypress=false;
    }
    attach(element) {
      const doc=element.ownerDocument, win=doc.defaultView;
      const blur=()=>this.clearHeld();
      const visibility=()=>{if(doc.hidden)this.clearHeld();};
      element.addEventListener('blur',blur);win.addEventListener('blur',blur);
      doc.addEventListener('visibilitychange',visibility);
      this.disposables.push({dispose:()=>{element.removeEventListener('blur',blur);win.removeEventListener('blur',blur);doc.removeEventListener('visibilitychange',visibility);}});
    }
    dispose() {this.clearHeld(false);for(const d of this.disposables)d.dispose();}
    sequence(def,bits,type) {
      const event=(this.flags&2) && type!==1?':'+type:'';
      const mods=bits+1;
      if(def.suffix!=='u' && mods===1 && !event)
        return '\x1b['+(def.number===1?'':def.number)+def.suffix;
      return `\x1b[${def.number}${mods!==1||event?';'+mods+event:''}${def.suffix}`;
    }
    handle(event) {
      if (!['keydown','keyup','keypress'].includes(event.type)) return true;
      const identity=physicalCode(event)||event.key;
      const metaKey=['Meta','OS','Super'].includes(event.key);
      if(this.android && metaKey) {
        if(event.type==='keydown')this.metaKeys.add(event.code||String(event.location||0));
        if(event.type==='keyup')this.metaKeys.delete(event.code||String(event.location||0));
      }
      // Patch only this terminal's Android event, preserving the native DOM event.
      if(this.android && this.metaKeys.size && !event.metaKey) {
        const original=event.getModifierState?.bind(event);
        Object.defineProperties(event,{
          metaKey:{configurable:true,value:true},
          getModifierState:{configurable:true,value:name=>name==='Meta'||Boolean(original?.(name))},
        });
      }
      if(!this.flags || this.term.options.disableStdin) return true;
      const consume=()=>{event.preventDefault();event.stopPropagation();return false;};
      if(event.type==='keypress')return this.suppressKeypress?consume():true;
      let previous=this.down.get(identity);
      if(event.type==='keyup') {
        // Some Android IMEs emit only the release of an Alt dead key. Recover
        // that chord here too, never falling back to legacy ESC text in Kitty mode.
        if(!previous && this.android && event.altKey && event.key==='Dead' &&
           !event.isComposing && !lock(event,'AltGraph') && (this.flags&9)) {
          const def=keyDefinition(event,this.flags,this.android);
          if(def) {
            this.term.input(this.sequence(def,this.bits(event),1),true);
            previous={def,reported:true};this.suppressed.add(identity);
          }
        }
        this.down.delete(identity);
        const suppressed=this.suppressed.delete(identity);
        this.suppressKeypress=false;
        if(previous?.reported && (this.flags&2)) {
          let bits=this.bits(event);
          if(previous.def.modifier && ![...this.down.values()].some(k=>k.def.modifier===previous.def.modifier)) bits &= ~previous.def.modifier;
          if(metaKey && this.metaKeys.size) bits|=8;
          this.term.input(this.sequence(previous.def,bits,3),true);
        }
        return suppressed?consume():true;
      }
      this.suppressKeypress=false;
      if(event.isComposing || event.keyCode===229 && event.key==='Unidentified')return true;
      if(event.key==='Dead' && !(this.android && event.altKey && !lock(event,'AltGraph')))return true;
      const def=keyDefinition(event,this.flags,this.android);
      if(!def)return true;
      let bits=this.bits(event);
      if(def.modifier!==undefined) {
        if(!(this.flags&8))return true;
        bits|=def.modifier;
      }
      const all=Boolean(this.flags&8);
      // Enter/Tab/Backspace remain recovery keys unless modified or report-all is requested.
      if(!all && def.recovery && !(bits&~192))return true;
      const shortcut=Boolean(bits&62);
      if(def.text && !all && !(this.flags&1 && shortcut))return true;
      // With only event reporting requested, leave legacy printable shortcuts untouched.
      if(def.text && !all && !(this.flags&1))return true;
      const type=event.repeat?2:1;
      this.down.set(identity,{def,reported:!(def.recovery && !all)});this.suppressed.add(identity);this.suppressKeypress=true;
      this.term.input(this.sequence(def,bits,type),true);
      return consume();
    }
    bits(e) {
      const altgr=lock(e,'AltGraph');
      return (e.shiftKey?1:0)|(!altgr&&e.altKey?2:0)|(!altgr&&e.ctrlKey?4:0)|
        (e.metaKey || this.android&&this.metaKeys.size?8:0)|
        (lock(e,'Hyper')?16:0)|(lock(e,'CapsLock')?64:0)|(lock(e,'NumLock')?128:0);
    }
  }
  const api={KittyKeyboard,SUPPORTED};
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.GoTTYKittyKeyboard=api;
})(globalThis);
