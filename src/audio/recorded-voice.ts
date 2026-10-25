export type VoiceClip = { id: string; lineId: string; speaker: string; text: string; src: string };
export type VoiceState = {status:'idle'|'loading'|'playing'|'paused'|'blocked'|'ended'|'failed'; clip?:VoiceClip; userPaused:boolean};
export const voiceBlocksAuto = (state:VoiceState) => ['loading','playing','paused','blocked'].includes(state.status);
export class RecordedVoice {
  private state:VoiceState={status:'idle',userPaused:false};
  private listeners=new Set<()=>void>();
  private audio:HTMLAudioElement|null=null;
  private generation=0;
  private visit='';
  private enabled=true;
  private volume=0.8;
  private readable=false;
  private visible=true;
  private history=false;
  private historyReplay=false;
  constructor(private factory:(src:string)=>HTMLAudioElement = src=>new Audio(src)) {}
  getState=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private emit(next:Partial<VoiceState>){this.state={...this.state,...next};this.listeners.forEach(fn=>fn());}
  private allowed(){return this.enabled&&this.visible&&(this.historyReplay?this.history:this.readable);}
  configure(enabled:boolean,volume:number,readable:boolean,visible:boolean,history:boolean){
    this.enabled=enabled;this.volume=Math.max(0,Math.min(1,Number.isFinite(volume)?volume:0.8));
    this.readable=readable;this.visible=visible;this.history=history;
    if(this.audio)this.audio.volume=this.volume;
    if(!enabled||(this.historyReplay&&!history)){this.stop();return;}
    if(!this.allowed()){this.pause(false);return;}
    if(this.state.status==='paused'&&!this.state.userPaused)void this.play();
  }
  enter(clip:VoiceClip|undefined,visit:string){
    if(visit===this.visit)return;
    this.visit=visit;this.historyReplay=false;this.start(clip);
  }
  replay(clip:VoiceClip,history=false){this.historyReplay=history;this.start(clip);}
  private start(clip:VoiceClip|undefined){
    this.stopAudio();this.state={status:'idle',userPaused:false};
    if(!clip||!this.enabled){this.emit({});return;}
    this.audio=this.factory(clip.src);this.audio.volume=this.volume;this.audio.preload='auto';
    const player=this.audio;
    player.onended=()=>{if(player===this.audio){this.generation++;this.emit({status:'ended',userPaused:false});}};
    player.onerror=()=>{if(player===this.audio){this.generation++;this.emit({status:'failed',userPaused:false});}};
    this.emit({clip,status:'paused',userPaused:false});
    if(this.allowed())void this.play();
  }
  private async play(){
    const player=this.audio;if(!player||!this.allowed())return;
    const generation=++this.generation;this.emit({status:'loading',userPaused:false});
    try{
      await player.play();
      if(player!==this.audio){player.pause();return;}
      if(generation!==this.generation){if(this.state.status==='paused')player.pause();return;}
      if(!this.allowed()){player.pause();this.emit({status:'paused'});return;}
      this.emit({status:'playing'});
    }catch(error){
      if(player!==this.audio||generation!==this.generation)return;
      this.emit({status:error instanceof Error&&error.name==='NotAllowedError'?'blocked':'failed',userPaused:false});
    }
  }
  pause(manual=true){
    if(!this.audio||!['playing','loading','paused'].includes(this.state.status))return;
    this.generation++;this.audio.pause();this.emit({status:'paused',userPaused:this.state.userPaused||manual});
  }
  resume(){if(this.state.status==='paused'||this.state.status==='blocked')void this.play();}
  unlock(){if(this.state.status==='blocked')void this.play();}
  private stopAudio(){this.generation++;if(this.audio){this.audio.onended=null;this.audio.onerror=null;this.audio.pause();this.audio.removeAttribute?.('src');this.audio.load?.();this.audio=null;}}
  stop(){this.stopAudio();this.visit='';this.historyReplay=false;this.state={status:'idle',userPaused:false};this.emit({});}
}
