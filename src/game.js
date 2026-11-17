// Deterministic game simulation: all sound, replay, tutorial progression and threat timing use game time.
export const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function floorAt(x, z) {
  if (x >= -5 && x <= 5 && z >= 0 && z <= 10) return 3;
  if (x >= -3 && x <= 3 && z >= -16 && z < 0) return 3;
  if (x >= -10 && x <= 10 && z >= -19 && z < -16) return 3;
  if (x >= -8 && x <= -5 && z >= -29 && z < -19) return 3 * (z + 29) / 10;
  if (x >= -10 && x <= -8.2 && z >= -36 && z < -19) return 3;
  if (x >= -10 && x <= 10 && z >= -36 && z < -19) return 0;
  if (x >= -6 && x <= 6 && z >= -50 && z < -36) return 0;
  return null;
}

export class Game {
  constructor(onEvent = () => {}, onNotice = () => {}) {
    this.onEvent = onEvent;
    this.onNotice = onNotice;
    this.reset();
  }

  reset() {
    this.time = 0;
    this.phase = 0;
    this.player = V(0, 3, 6);
    this.yaw = 0;
    this.pitch = 0;
    this.moveMode = 'normal';
    this.steps = 0;
    this.travel = 0;
    this.echoAt = 0;
    this.bridgeEchoAt = 0;
    this.anomalyArmed = false;
    this.anomalyDone = false;
    this.wellAnomalyStage = 0;
    this.flickerUntil = 0;
    this.holdSoundAt = 0;
    this.hasRecorder = false;
    this.buffer = [];
    this.clip = [];
    this.clipDuration = 6;
    this.device = null;
    this.learned = false;
    this.inlet = false;
    this.valve = false;
    this.power = false;
    this.motor = false;
    this.paper = false;
    this.motorProgress = 0;
    this.danger = 0;
    this.proximity = 0;
    this.warnedProximityAt = 0;
    this.failed = false;
    this.ended = false;
    this.deathReason = '';
    this.lastLoudAction = '';
    this.threat = { ...V(4, 0.2, -24), target: V(7, 0, -25), until: 0, mode: '巡游', score: 0 };
    this.pulseAt = 0;
    this.sourceAt = 0;
    this.threatSoundAt = 0;
    this.hold = 0;
    this.holding = '';
    this.inletProgress = 0;
    this.valveProgress = 0;
    this.powerProgress = 0;
    this.lastActionFeedback = null;
    this.observations = {};
    this.checkpoint = 0;
    this.lureCount = 0;
    this.tutorialReplay = false;
    this.tutorialExpiredHinted = false;
    this.stats = { events: 0, replays: 0, deaths: 0, walked: 0 };
    this.notice('凌晨四点，最后一次值班。先拨开东侧值班窗的窗扣。', 7);
  }

  notice(s, d = 5) {
    this.onNotice(s, d);
  }

  feedback(kind, id, text = '') {
    this.lastActionFeedback = { time: this.time, kind, id, text };
  }

  sound(type, pos, strength = 1, replay = false) {
    const e = { time: this.time, type, pos: { ...pos }, strength, replay };
    this.stats.events++;
    this.onEvent(e);
    if (!replay && ['concrete', 'metal', 'splash', 'knock', 'pump', 'motor', 'relay', 'wheel'].includes(type) && distance(pos, this.player) < 32) {
      this.buffer.push(e);
    }
    if (['concrete', 'metal', 'splash', 'knock', 'pump', 'motor', 'wheel'].includes(type) && this.phase >= 2) {
      const score = strength / (1 + distance(pos, this.threat) * 0.045);
      if (score >= this.threat.score * 0.7 || this.time > this.threat.until) {
        this.threat.target = { ...pos };
        this.threat.until = this.time + (replay ? 8.0 : 4.0);
        this.threat.score = score;
        this.threat.mode = replay ? '追随回放' : '循声';
        if (replay) this.lureCount++;
        else if (distance(pos, this.player) < 1.2) {
          this.lastLoudAction = this.moveMode === 'sprint' ? 'sprint' : this.holding ? 'hold' : type;
        }
      }
    }
  }

  capture() {
    if (this.failed || this.ended) return false;
    if (!this.hasRecorder) {
      this.sound('blocked', this.player, 0.12);
      this.notice('先从值班桌上拿起便携录放机。', 4);
      return false;
    }
    if (this.device) {
      this.sound('blocked', this.player, 0.12);
      this.notice('录放机已放在地上。走近对准它按 E 取回后才能重录。', 5);
      return false;
    }
    const recent = this.buffer.filter(e => this.time - e.time <= 6);
    if (!recent.length) {
      this.sound('blocked', this.player, 0.12);
      this.notice('刚过去 6 秒没有明显声响。先敲击铁管/悬钟或走几步，再按 R。', 5);
      return false;
    }
    const firstT = Math.min(...recent.map(e => e.time));
    const lastT = Math.max(...recent.map(e => e.time));
    const span = Math.max(0, lastT - firstT);
    this.clip = recent.map(e => ({
      ...e,
      type: e.type === 'wheel' ? 'knock' : e.type,
      time: Math.min(5.85, Math.max(0.08, e.time - firstT + 0.10))
    }));
    this.clipDuration = 6;
    this.sound('recorded', this.player, 0.22);
    this.feedback('recorded', 'recorder');
    const knocks = this.clip.filter(c => c.type === 'knock').length;
    const summary = knocks ? `含 ${knocks} 次金属敲击` : `含 ${this.clip.length} 段脚步/环境声`;
    this.notice(`已录入磁带（${summary}）。走到目标位置按 Q 放下诱饵。`, 5.5);
    return true;
  }

  getPlacementPreview() {
    if (!this.hasRecorder || !this.clip.length || this.device || this.failed || this.ended) return null;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    for (const distAhead of [0.72, 0.42]) {
      const tx = this.player.x + fx * distAhead;
      const tz = this.player.z + fz * distAhead;
      const fy = floorAt(tx, tz);
      if (fy !== null && Math.abs(fy - this.player.y) <= 0.45 && this.canMove(tx, tz)) {
        return { x: tx, y: fy, z: tz, valid: true, wet: fy < 1.0 };
      }
    }
    return { x: this.player.x, y: this.player.y, z: this.player.z, valid: true, wet: this.player.y < 1.0 };
  }

  place() {
    if (this.failed || this.ended) return false;
    if (!this.hasRecorder) {
      this.sound('blocked', this.player, 0.12);
      this.notice('先从值班桌上拿起便携录放机。', 4);
      return false;
    }
    if (this.device) {
      this.sound('blocked', this.player, 0.12);
      this.notice('录放机已在地面工作。靠近对准按 E 取回后可重新放置。', 5);
      return false;
    }
    if (!this.clip.length) {
      this.sound('blocked', this.player, 0.12);
      this.notice('磁带还是空白的。先敲击金属或走动发声，按 R 录下后再按 Q。', 5);
      return false;
    }
    const spot = this.getPlacementPreview() || { ...this.player };
    this.tutorialExpiredHinted = false;
    this.device = {
      pos: V(spot.x, spot.y, spot.z),
      placed: this.time,
      at: this.time + 4,
      lastBeat: 0,
      played: -1,
      end: this.time + 24,
      loopLen: this.clipDuration || 6
    };
    this.sound('place', this.device.pos, 0.3);
    this.feedback('placed', 'device');
    if (this.phase === 2) {
      this.notice('录放机已放下 · 4 秒后开始回放。现在退开 3 米以上！', 5);
    } else {
      this.notice('已放置诱饵 · 4 秒后在原地循环回放。趁现在撤离。', 4.5);
    }
    return true;
  }

  retrieve() {
    if (this.failed || this.ended) return false;
    if (this.device && distance(this.device.pos, this.player) <= 2.75) {
      this.sound('pickup', this.device.pos, 0.18);
      this.device = null;
      this.feedback('retrieved', 'device');
      this.notice('已取回录放机，磁带录音保留，可随时按 Q 再次布置。', 4.5);
      return true;
    }
    return false;
  }

  canMove(x, z) {
    const f = floorAt(x, z);
    if (f === null || Math.abs(f - this.player.y) > 0.7) return false;
    if (this.colliders?.some(c => !c.doorSightOnly && x > c.minX - 0.25 && x < c.maxX + 0.25 && z > c.minZ - 0.25 && z < c.maxZ + 0.25 && f + 1.5 > c.minY && f + 0.1 < c.maxY)) return false;
    if (z < -15.4 && this.phase < 3) return false;
    if (z < -35.65 && (!this.valve || !this.power)) return false;
    return true;
  }

  move(dx, dz, dt, modeOrSlow = false) {
    if (this.failed || this.ended) return;
    const mode = modeOrSlow === 'sprint' ? 'sprint' : (modeOrSlow === true || modeOrSlow === 'quiet') ? 'quiet' : 'normal';
    this.moveMode = mode;
    const speed = mode === 'sprint' ? 3.45 : mode === 'quiet' ? 1.20 : 2.30;
    const stepStride = mode === 'sprint' ? 1.08 : mode === 'quiet' ? 1.24 : 1.44;
    const mag = Math.hypot(dx, dz);
    if (mag === 0) return;
    dx = (dx / mag) * speed * dt;
    dz = (dz / mag) * speed * dt;
    const ox = this.player.x, oz = this.player.z;
    for (const axis of ['x', 'z']) {
      const p = { ...this.player };
      p[axis] += axis === 'x' ? dx : dz;
      if (this.canMove(p.x, p.z)) {
        this.player[axis] = p[axis];
        this.player.y = floorAt(p.x, p.z);
      }
    }
    const moved = Math.hypot(this.player.x - ox, this.player.z - oz);
    this.travel += moved;
    this.stats.walked += moved;
    if (this.travel > stepStride) {
      this.travel = 0;
      this.steps++;
      const inWater = this.player.y < 1;
      const type = inWater ? 'splash' : this.player.z < 0 ? 'metal' : 'concrete';
      const strength = mode === 'sprint'
        ? (inWater ? 2.35 : 1.85)
        : mode === 'quiet'
          ? (inWater ? 0.26 : 0.18)
          : 1.0;
      this.sound(type, this.player, strength);
      if (this.anomalyArmed && !this.anomalyDone && this.steps >= 4) {
        this.anomalyDone = true;
        this.echoAt = this.time + 0.95;
      }
    }
    if (this.paper && this.player.z > 1 && !this.ended) this.phase = 6;
  }

  act(id, held = false) {
    if (this.failed || this.ended) return false;

    if (id === 'device') {
      const ok = this.retrieve();
      if (!ok) {
        this.sound('blocked', this.player, 0.12);
        this.notice('离录放机太远，再走近一步按 E 取回。', 3.5);
      }
      return ok;
    }

    if (id === 'gauge-upper' || id === 'gauge-lower') {
      this.observations[id] = true;
      this.sound('switch', this.player, 0.15);
      this.feedback('inspect', id);
      if (id === 'gauge-upper') {
        this.notice('外海水位尺露出大半截刻痕——潮水早已退去。记住这条水线。', 8);
      } else {
        this.notice(
          this.inlet
            ? '进水总阀已经锁死，可黄色检修梯又被淹没了一格。水不是从海里进来的。'
            : '从泵房低处看，积水漫过了黄色梯子第三格，比外海退潮线高出一截。',
          9
        );
      }
      return true;
    }

    if (id === 'pump-listen') {
      this.observations.pump = true;
      this.sound('switch', this.player, 0.25);
      this.sound('pump', V(7, 0, -25), 4.2);
      this.feedback('press', id);
      this.notice('东侧检修泵试鸣一声。留在干燥步道上，看水纹是否朝声音转向，再决定诱饵放向何处。', 8);
      return true;
    }

    if (id === 'latch') {
      if (this.phase === 0) {
        this.phase = 1;
        this.steps = 0;
        this.anomalyArmed = true;
        this.sound('latch', V(4.7, 4.35, 4.65), 1.6);
        this.feedback('success', 'latch');
        this.notice('值班窗已推开，窗外正在退潮。转身拿起桌上的便携录放机。', 6.5);
        return true;
      }
      return false;
    }

    if (id === 'pickup') {
      if (this.hasRecorder) return false;
      if (this.phase < 1) {
        this.sound('blocked', this.player, 0.15);
        this.feedback('blocked', 'pickup');
        this.notice('先拨开东侧值班窗的窗扣确认潮位，再拿取录放机。', 5);
        return false;
      }
      this.hasRecorder = true;
      this.phase = 2;
      this.checkpoint = 1;
      this.sound('pickup', V(3.05, 4.12, 3.65), 0.35);
      this.feedback('success', 'pickup');
      this.notice('已拿到便携录放机。走上廊桥敲击悬钟，按 R 录下刚过去的 6 秒声音。', 7);
      return true;
    }

    if (['bell', 'pipe', 'terminal-pipe'].includes(id)) {
      this.sound('knock', this.player, 5);
      this.feedback('knock', id);
      if (this.hasRecorder && !this.device) {
        this.notice('清脆的金属回响已进入 6 秒缓存——现在按 R 将它录进磁带。', 5);
      } else if (this.device) {
        this.notice('金属敲击声已在水中传开！小心暴露自己的位置。', 4.5);
      } else {
        this.notice('金属声沿着站体传向深处。', 3.5);
      }
      return true;
    }

    if (id === 'south-door') {
      if (!this.power || !this.valve) {
        this.sound('blocked', this.player, 0.18);
        this.feedback('blocked', 'south-door');
        this.notice(
          !this.inlet
            ? '水密闸门断电闭锁：先关①西侧进水阀，再关②东侧泄压阀，最后合上③西侧供电开关。'
            : !this.valve
              ? '水密闸门联锁未解除：请先关闭东侧泄压旁通阀，再去西侧合闸送电。'
              : '水密闸门尚未通电：前往泵房西侧电箱合上控制室供电开关即可升起闸门。',
          5.5
        );
        return false;
      }
      return false;
    }

    if (id === 'gate') {
      if (this.phase < 3) {
        this.sound('blocked', this.player, 0.15);
        this.feedback('blocked', 'gate');
        if (!this.hasRecorder) this.notice('先回值班室开窗并拿起桌上的便携录放机。', 5);
        else if (!this.clip.length) this.notice('先敲击廊桥悬钟（E），立即按 R 录下声音。', 5);
        else if (!this.device) this.notice('磁带已就绪！按 Q 把录放机放在栅门附近地面。', 5);
        else this.notice('退后离开录放机至少 3 米，等它回放出声音即可解锁栅门。', 5);
        return false;
      }
      return false;
    }

    if (id === 'inlet') {
      if (this.inlet) {
        this.notice('西侧进水隔离阀已完全锁死，无需重复操作。', 3.5);
        return false;
      }
      if (this.phase < 3) {
        this.sound('blocked', this.player, 0.15);
        this.notice('请先完成廊桥声学联络测试。', 4);
        return false;
      }
      if (!held) {
        this.notice('持续按住 E 转动进水隔离手轮。每满一档自动锁止，松手撤离不会回退。', 5.5);
      }
      return true;
    }

    if (id === 'valve') {
      if (this.valve) {
        this.notice('东侧泄压旁通阀已完全关闭。前往西侧合上供电开关。', 4);
        return false;
      }
      if (!this.inlet) {
        this.sound('blocked', this.player, 0.18);
        this.feedback('blocked', 'valve');
        this.notice('管路仍在进水带压！必须先关闭西侧进水隔离阀，才能转动泄压阀。', 5.5);
        return false;
      }
      if (!held) {
        this.notice('持续按住 E 转动泄压阀。转动声会吸引水下注意，危险靠近时先松手撤退。', 5.5);
        return true;
      }
      this.hold += 1;
      return true;
    }

    if (id === 'power') {
      if (this.power) {
        this.notice('控制室供电已接通，南侧防水门已解锁。', 4);
        return false;
      }
      if (!this.valve) {
        this.sound('blocked', this.player, 0.18);
        this.feedback('blocked', 'power');
        this.notice(
          !this.inlet
            ? '联锁保护锁止：请先关闭西侧进水隔离阀，再关闭东侧泄压阀。'
            : '防潮联锁锁止：请先到东侧关闭泄压旁通阀，再回来合闸。',
          5.5
        );
        return false;
      }
      if (!held) {
        this.notice('持续按住 E 蓄力合上供电开关（满半程锁止一档）。', 4.5);
        return true;
      }
      this.hold += 1;
      return true;
    }

    if (id === 'machine') {
      if (this.paper) {
        this.notice('最后一卷记录纸已经收好。沿原路返回值班室窗口交接。', 4.5);
        return false;
      }
      if (!this.power) {
        this.sound('blocked', this.player, 0.18);
        this.feedback('blocked', 'machine');
        this.notice('自记仪没有通电。先回泵房西侧合上记录室供电开关。', 5);
        return false;
      }
      if (!this.motor) {
        this.motor = true;
        this.phase = 5;
        this.wellAnomalyStage = 0;
        this.sound('relay', V(0, 1, -45), 1.2);
        this.feedback('success', 'machine');
        this.notice('自记仪已启动！走纸电机会持续发声（24 秒），用诱饵把水下声源引向远处！', 7.5);
        return true;
      }
      if (this.motorProgress >= 24) {
        if (distance(this.threat, V(0, 0, -45)) < 3.8) {
          this.sound('blocked', this.player, 0.18);
          this.feedback('blocked', 'machine');
          this.notice('水下声源正盘踞在自记仪旁！先在控制室另一端放下回放诱饵引开它。', 5.5);
          return false;
        }
        this.paper = true;
        this.motor = false;
        this.phase = 6;
        this.device = null;
        this.sound('paper', V(0, 1.2, -45), 0.6);
        this.feedback('success', 'machine');
        this.notice('已取下最后一卷潮汐记录纸（录放机已收回）。沿原路回值班窗，切勿在水中奔跑！', 8);
        return true;
      }
      this.sound('blocked', this.player, 0.1);
      this.notice(`自记仪正在绘制最后一段潮位曲线……还需 ${Math.ceil(24 - this.motorProgress)} 秒。`, 4);
      return false;
    }

    if (id === 'exit') {
      if (!this.paper) {
        this.sound('blocked', this.player, 0.12);
        this.notice('尚未取回末端控制室 07 号自记仪上的记录纸。', 4.5);
        return false;
      }
      this.ended = true;
      this.phase = 7;
      this.feedback('success', 'exit');
      this.notice('窗外早已退潮见底。水位尺背面，传来了湿重的脚步。', 8);
      this.sound('knock', V(16, 2, -1), 3);
      return true;
    }

    return false;
  }

  updateHold(id, dt) {
    if (this.failed || this.ended) {
      this.hold = 0;
      this.holding = '';
      return;
    }
    if (id !== this.holding) {
      if (this.holding === 'power' && !this.power) {
        this.powerProgress = this.powerProgress >= 2.0 ? 2.0 : 0;
      }
      this.holding = id;
      this.hold = 0;
    }

    if (id === 'inlet' && !this.inlet && this.phase === 3) {
      const old = this.inletProgress;
      this.inletProgress = Math.min(5.5, this.inletProgress + dt);
      this.hold = this.inletProgress;
      if (Math.floor(old / 1.833) < Math.floor(this.inletProgress / 1.833) && this.inletProgress < 5.45) {
        const notch = Math.floor(this.inletProgress / 1.833);
        this.sound('detent', this.player, 1.4);
        this.feedback('detent', 'inlet');
        this.notice(`止回棘爪卡入第 ${notch}/3 档。松手不会回退，听见水声逼近可先撤回楼梯。`, 5);
      }
      if (this.time > this.holdSoundAt) {
        this.sound('wheel', this.player, 2.6);
        this.holdSoundAt = this.time + 1.15;
      }
      if (this.inletProgress >= 5.5) {
        this.inlet = true;
        this.hold = 0;
        this.sound('detent', this.player, 2.2);
        this.feedback('success', 'inlet');
        this.notice('西侧进水隔离阀已锁死！接下来布置诱饵，前往东侧关闭泄压旁通阀。', 7);
      }
    } else if (id === 'valve' && !this.valve && this.inlet && this.phase === 3) {
      const old = this.valveProgress;
      this.valveProgress = Math.min(7.0, this.valveProgress + dt);
      this.hold = this.valveProgress;
      if (Math.floor(old / 2.333) < Math.floor(this.valveProgress / 2.333) && this.valveProgress < 6.95) {
        const notch = Math.floor(this.valveProgress / 2.333);
        this.sound('detent', this.player, 1.5);
        this.feedback('detent', 'valve');
        this.notice(`泄压手轮锁入第 ${notch}/3 档。若水纹靠近脚下，立刻松手退向干燥楼梯。`, 5);
      }
      if (this.time > this.holdSoundAt || !this.holdSoundAt) {
        this.sound('wheel', this.player, 2.5);
        this.holdSoundAt = this.time + 1.1;
      }
      if (this.valveProgress >= 7.0) {
        this.valve = true;
        this.hold = 0;
        this.sound('detent', this.player, 2.4);
        this.feedback('success', 'valve');
        this.notice('东侧泄压阀已关闭，泵机停振。回到西侧电箱合上控制室供电开关。', 7);
      }
    } else if (id === 'power' && !this.power && this.valve) {
      const old = this.powerProgress;
      this.powerProgress = Math.min(4.0, old + dt);
      this.hold = this.powerProgress;
      if (old < 2.0 && this.powerProgress >= 2.0) {
        this.sound('detent', this.player, 1.3);
        this.feedback('detent', 'power');
        this.notice('隔离开关预储能锁定（1/2）——继续按住完成合闸。', 4);
      }
      if (this.time > this.holdSoundAt) {
        this.sound('switch', this.player, 1.5);
        this.holdSoundAt = this.time + 1.25;
      }
      if (this.powerProgress >= 4.0) {
        this.power = true;
        this.phase = 4;
        this.checkpoint = 2;
        this.hold = 0;
        this.sound('breaker', this.player, 3.0);
        this.device = null;
        this.feedback('success', 'power');
        this.notice('控制室供电已接通（录放机已自动收回随身）。南侧末端防水门已开启。', 7.5);
      }
    } else {
      this.hold = 0;
    }
  }

  restore() {
    const cp = this.checkpoint;
    const deaths = this.stats.deaths + 1;
    this.reset();
    this.stats.deaths = deaths;
    if (cp >= 1) {
      this.hasRecorder = true;
      this.phase = 3;
      this.learned = true;
      this.tutorialReplay = true;
      this.anomalyDone = true;
      this.player = V(-6.5, 3, -17.5);
      this.checkpoint = 1;
      this.clip = [
        { time: 0.12, type: 'knock', strength: 5 },
        { time: 1.85, type: 'knock', strength: 5 }
      ];
      this.clipDuration = 6;
    }
    if (cp >= 2) {
      this.inlet = true;
      this.inletProgress = 5.5;
      this.valve = true;
      this.valveProgress = 7.0;
      this.power = true;
      this.powerProgress = 4.0;
      this.phase = 4;
      this.player = V(0, 0, -37.5);
      this.threat = { ...V(6, 0.2, -27), target: V(7, 0, -25), until: 0, mode: '巡游', score: 0 };
      this.checkpoint = 2;
    }
    this.notice('已从最近安全检查点恢复，录放机与磁带已归还。先看清水纹位置再行动。', 7);
  }

  tick(dt) {
    if (this.failed || this.ended) return;
    this.time += dt;
    this.buffer = this.buffer.filter(e => this.time - e.time < 6);

    if (this.echoAt && this.time >= this.echoAt) {
      this.sound('metal', V(this.player.x, 0, this.player.z), 1.8);
      this.echoAt = 0;
      this.notice('……你停下了，楼板下面的水里却多响了第五步。', 6.5);
    }

    if (this.bridgeEchoAt && this.time >= this.bridgeEchoAt) {
      this.bridgeEchoAt = 0;
      this.sound('submerged', V(1.5, 0, -20.5), 1.6);
    }

    if (this.device) {
      const d = this.device;
      const loopLen = d.loopLen || 6;
      if (this.time < d.at) {
        const b = Math.ceil(d.at - this.time);
        if (b !== d.lastBeat) {
          d.lastBeat = b;
          this.sound('countdown', d.pos, 0.22);
        }
      } else if (this.time < d.end) {
        const elapsedPlay = this.time - d.at;
        const cycle = Math.floor(elapsedPlay / loopLen);
        const t = elapsedPlay % loopLen;
        this.clip.forEach((e, i) => {
          const triggerT = Math.min(loopLen - 0.05, e.time);
          const k = cycle * 1000 + i;
          if (triggerT <= t && k > d.played) {
            d.played = k;
            this.sound(e.type, d.pos, e.strength * 2, true);
            this.stats.replays++;
          }
        });
        if (this.phase === 2 && d.played >= 0 && distance(d.pos, this.player) > 3.0) {
          this.tutorialReplay = true;
          this.learned = true;
          this.phase = 3;
          this.bridgeEchoAt = this.time + 1.1;
          this.sound('latch', V(0, 3.6, -15.65), 1.2);
          this.feedback('success', 'gate');
          this.notice('声音从机器的位置传回，水下有东西被吸引过去了！前方泵房栅门已开，记得取回录放机。', 8.5);
        }
      } else if (!d.done) {
        d.done = true;
        if (this.phase === 2 && !this.tutorialExpiredHinted) {
          this.tutorialExpiredHinted = true;
          this.notice('回放结束时你离录放机不足 3 米。走近按 E 取回，按 Q 放下后退开 3 米以上。', 7);
        } else {
          this.notice('20 秒回放已结束。磁带仍在，靠近录放机按 E 取回即可再次使用。', 5.5);
        }
      }
    }

    if (this.phase >= 3 && this.phase < 7) {
      if (this.time >= this.sourceAt && !this.valve) {
        this.sourceAt = this.time + 9;
        this.sound('pump', V(7, 0, -25), 3.5);
      }
      if (this.motor) {
        this.motorProgress += dt;
        if (this.time >= this.pulseAt) {
          this.pulseAt = this.time + 2;
          this.sound('motor', V(0, 1, -45), 2.5);
        }
        if (this.wellAnomalyStage === 0 && this.motorProgress >= 7) {
          this.wellAnomalyStage = 1;
          this.flickerUntil = this.time + 1.4;
          this.sound('submerged', V(-2.5, 0, -46), 1.5);
          this.notice('测潮静水井里的浮筒猛地往上一顶——纸上的水线正在反常抬升！', 6);
        } else if (this.wellAnomalyStage === 1 && this.motorProgress >= 17) {
          this.wellAnomalyStage = 2;
          this.flickerUntil = this.time + 1.1;
          this.sound('knock', V(0, 0.4, -49.5), 1.8);
        }
      }

      const th = this.threat;
      if (this.time > th.until) {
        th.mode = '巡游';
        th.score = 0;
        th.target = V(4 + Math.sin(this.time * 0.08) * 4, 0, -27 + Math.cos(this.time * 0.07) * 4);
      }
      const d = distance(th, th.target);
      const speed = th.mode === '巡游' ? 0.5 : 1.25;
      if (d > 0.25 && this.time >= this.threatSoundAt) {
        const playerDist = distance(th, this.player);
        this.threatSoundAt = this.time + (playerDist < 4.5 ? 1.35 : 2.6);
        this.sound('threat', th, playerDist < 4.5 ? 1.1 : 0.65);
      }
      if (d > 0.25) {
        th.x += ((th.target.x - th.x) / d) * dt * speed;
        th.z += ((th.target.z - th.z) / d) * dt * speed;
      }
      th.x = Math.max(-9, Math.min(9, th.x));
      th.z = Math.max(this.power ? -48 : -35, Math.min(-19.5, th.z));
      if (th.z < -36) th.x = Math.max(-5.4, Math.min(5.4, th.x));

      const distToPlayer = distance(th, this.player);
      const onWetFloor = this.player.y < 1.3;

      if (onWetFloor && distToPlayer < 4.3) {
        this.proximity = Math.min(1, (4.3 - distToPlayer) / 2.6);
        if (distToPlayer < 3.4 && this.time > this.warnedProximityAt) {
          this.warnedProximityAt = this.time + 5.5;
          this.sound('submerged', th, 0.9);
        }
      } else {
        this.proximity = Math.max(0, this.proximity - dt * 2.2);
      }

      if (onWetFloor && distToPlayer < 1.7) {
        this.danger += dt;
        if (this.danger > 2.4) {
          this.failed = true;
          if (this.device && distance(this.device.pos, this.player) < 2.3 && this.time >= this.device.at && !this.device.done) {
            this.deathReason = 'self-bait';
          } else if (this.holding) {
            this.deathReason = 'hold';
          } else if (this.moveMode === 'sprint' || this.lastLoudAction === 'sprint') {
            this.deathReason = 'sprint';
          } else if (this.motor && distance(this.player, V(0, 0, -45)) < 3.5) {
            this.deathReason = 'machine';
          } else {
            this.deathReason = 'water';
          }
          this.sound('fail', this.player, 1.4);
          this.notice('水声停在了你的脚下。', 5);
        }
      } else {
        this.danger = Math.max(0, this.danger - dt * 1.5);
      }

      if (
        this.phase === 3 &&
        this.observations.pump &&
        !this.observations.pumpConfirmed &&
        this.player.y > 1.5 &&
        this.player.z <= -16 &&
        !this.holding &&
        distance(th, V(7, 0, -25)) < 1.2 &&
        distance(th.target, V(7, 0, -25)) < 0.2 &&
        th.mode === '循声'
      ) {
        this.observations.pumpConfirmed = true;
        this.notice('水纹停在了东侧检修泵旁！把声源留在一侧，就能安全从另一侧通过。', 8.5);
      }
    } else {
      this.proximity = 0;
      this.danger = 0;
    }
  }
}
