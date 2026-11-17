// Screen-center ray selection, structural sight-blocking, and unified interaction state.
// Prompt display and KeyE actuation share evaluateInteraction() so UI and gameplay never diverge.

export function hasClearInteractionPath(eye, target, colliders = []) {
  const delta = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
  const length = Math.hypot(delta.x, delta.y, delta.z);
  if (length < 0.001) return true;
  for (const c of colliders) {
    if (!c.blocksSight) continue;
    let near = 0, far = 1;
    for (const axis of ['x', 'y', 'z']) {
      const key = axis.toUpperCase(), d = delta[axis];
      if (Math.abs(d) < 1e-9) {
        if (eye[axis] < c['min' + key] || eye[axis] > c['max' + key]) { near = 2; break; }
        continue;
      }
      let a = (c['min' + key] - eye[axis]) / d;
      let b = (c['max' + key] - eye[axis]) / d;
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a);
      far = Math.min(far, b);
      if (near > far) break;
    }
    if (near <= far && far > 0 && near < 1 - 0.045 / length) return false;
  }
  return true;
}

const SPECS = {
  latch:           { hitRadius: 0.28, maxDist: 2.85, priority: 1.0 },
  exit:            { hitRadius: 0.30, maxDist: 2.90, priority: 1.0 },
  pickup:          { hitRadius: 0.30, maxDist: 2.85, priority: 1.15 },
  device:          { hitRadius: 0.35, maxDist: 3.15, priority: 1.20, maxHoriz: 2.70 },
  bell:            { hitRadius: 0.28, maxDist: 2.85, priority: 1.0 },
  pipe:            { hitRadius: 0.30, maxDist: 2.80, priority: 0.95 },
  'terminal-pipe': { hitRadius: 0.30, maxDist: 2.80, priority: 0.95 },
  gate:            { hitRadius: 0.45, maxDist: 2.85, priority: 0.75 },
  'south-door':    { hitRadius: 0.55, maxDist: 2.95, priority: 0.78 },
  inlet:           { hitRadius: 0.40, maxDist: 2.80, priority: 1.05 },
  valve:           { hitRadius: 0.42, maxDist: 2.80, priority: 1.05 },
  power:           { hitRadius: 0.38, maxDist: 2.80, priority: 1.05 },
  machine:         { hitRadius: 0.62, maxDist: 3.05, priority: 1.10 },
  'pump-listen':   { hitRadius: 0.26, maxDist: 2.75, priority: 0.92 },
  'gauge-upper':   { hitRadius: 0.26, maxDist: 2.75, priority: 0.72 },
  'gauge-lower':   { hitRadius: 0.28, maxDist: 2.75, priority: 0.78 },
  'note-entry':    { hitRadius: 0.30, maxDist: 2.75, priority: 0.82 },
  'note-bridge':   { hitRadius: 0.30, maxDist: 2.75, priority: 0.82 },
  'note-pump':     { hitRadius: 0.30, maxDist: 2.75, priority: 0.82 }
};

export function evaluateInteraction(game, it) {
  const id = it.id;
  const spec = SPECS[id] || { hitRadius: 0.28, maxDist: 2.7, priority: 0.9 };
  const base = {
    id,
    visible: true,
    enabled: true,
    completed: false,
    busy: false,
    mode: 'press',
    label: it.label || id,
    sublabel: '',
    blockedReason: '',
    holdTotal: 0,
    progress: 0,
    ...spec
  };

  if (id === 'latch') {
    if (game.phase > 0) return { ...base, visible: false };
    return { ...base, label: '拨开值班窗扣', sublabel: '观察外海水位尺' };
  }

  if (id === 'exit') {
    if (!game.paper) return { ...base, visible: false };
    return { ...base, label: '对照外海水位尺 · 封站交接', sublabel: '完成最后一次值班' };
  }

  if (id === 'pickup') {
    if (game.hasRecorder) return { ...base, visible: false };
    if (game.phase < 1) {
      return {
        ...base,
        enabled: false,
        label: '便携磁带录放机',
        blockedReason: '先拨开东侧值班窗扣，确认潮位后再取设备'
      };
    }
    return { ...base, label: '拿起便携录放机', sublabel: '6 秒声学联络磁带机' };
  }

  if (id === 'device') {
    if (!game.device) return { ...base, visible: false };
    const playing = game.time >= game.device.at && !game.device.done;
    const waiting = game.time < game.device.at;
    return {
      ...base,
      label: '取回便携录放机',
      sublabel: waiting
        ? `倒计时 ${Math.ceil(game.device.at - game.time)}s · 取回将取消本次回放`
        : playing
          ? '正在回放 · 取回将立即停声'
          : '回放已结束 · 磁带内容保留'
    };
  }

  if (id === 'south-door') {
    if (game.power && game.valve) return { ...base, visible: false };
    return {
      ...base,
      enabled: false,
      label: '末端控制室水密闸门（闭锁）',
      blockedReason: !game.inlet
        ? '电磁闭锁 · 需依次关闭①西侧进水阀、②东侧泄压阀、③西侧供电开关'
        : !game.valve
          ? '泄压联锁未解除 · 请先关闭东侧泄压旁通阀，再合上西侧供电开关'
          : '断电闭锁 · 请前往泵房西侧电箱合上控制室供电开关'
    };
  }

  if (id === 'gate') {
    if (game.phase >= 3) return { ...base, visible: false };
    return {
      ...base,
      enabled: false,
      label: '泵房检修栅门（锁闭）',
      blockedReason: !game.hasRecorder
        ? '需先在值班室开窗并取得便携录放机'
        : !game.clip.length
          ? '先敲击廊桥悬钟并按 R 录下声音'
          : !game.device
            ? '按 Q 在地面放下录放机进行回放测试'
            : '退开至少 3 米，听见机器回放后解锁'
    };
  }

  if (id === 'bell' || id === 'pipe' || id === 'terminal-pipe') {
    const names = { bell: '敲击检修悬钟', pipe: '敲击西侧检修管', 'terminal-pipe': '敲击控制室回流管' };
    return {
      ...base,
      label: names[id] || base.label,
      sublabel: game.hasRecorder ? '制造清脆金属声（可按 R 录入磁带）' : '制造金属声响'
    };
  }

  if (id === 'inlet') {
    if (game.inlet) {
      return { ...base, enabled: false, completed: true, label: '进水隔离阀（已锁死）', sublabel: '3 / 3 档止回棘爪已落锁' };
    }
    if (game.phase < 3) {
      return { ...base, enabled: false, label: '进水隔离阀', blockedReason: '需先完成廊桥声学联络测试' };
    }
    const notch = Math.min(3, Math.floor((game.inletProgress || 0) / 1.83));
    return {
      ...base,
      mode: 'hold',
      holdTotal: 5.5,
      progress: game.inletProgress || 0,
      label: (game.inletProgress || 0) > 0.05 ? '继续关闭进水隔离阀' : '关闭进水隔离阀',
      sublabel: `按住 E 转动手轮 · 已锁 ${notch}/3 档（松手不回退）`
    };
  }

  if (id === 'valve') {
    if (game.valve) {
      return { ...base, enabled: false, completed: true, label: '泄压旁通阀（已关闭）', sublabel: '东侧管路残压已排空' };
    }
    if (!game.inlet) {
      return {
        ...base,
        enabled: false,
        label: '泄压旁通阀',
        blockedReason: '管路带压锁止 · 需先关闭西侧进水隔离阀'
      };
    }
    const notch = Math.min(3, Math.floor((game.valveProgress || 0) / 2.33));
    return {
      ...base,
      mode: 'hold',
      holdTotal: 7.0,
      progress: game.valveProgress || 0,
      label: (game.valveProgress || 0) > 0.05 ? '继续转动泄压旁通阀' : '关闭泄压旁通阀',
      sublabel: `按住 E 泄压 · 已锁 ${notch}/3 档（水声靠近可松手撤离）`
    };
  }

  if (id === 'power') {
    if (game.power) {
      return { ...base, enabled: false, completed: true, label: '控制室供电开关（已合闸）', sublabel: '南侧末端控制室已通电' };
    }
    if (!game.valve) {
      return {
        ...base,
        enabled: false,
        label: '控制室供电隔离开关',
        blockedReason: !game.inlet
          ? '联锁保护 · 需先关西侧进水阀，再关东侧泄压阀'
          : '防潮联锁保护 · 需先关闭东侧泄压旁通阀'
      };
    }
    const partial = game.powerProgress || 0;
    return {
      ...base,
      mode: 'hold',
      holdTotal: 4.0,
      progress: partial,
      label: partial > 0.05 ? '继续合上供电隔离开关' : '合上控制室供电开关',
      sublabel: partial >= 2.0 ? '按住 E 完成合闸 · 预储能已锁定（1/2）' : '按住 E 蓄力合闸（满半程锁档）'
    };
  }

  if (id === 'machine') {
    if (game.paper) {
      return { ...base, enabled: false, completed: true, label: '07 号潮汐自记仪', sublabel: '最后一卷记录纸已取走 · 返回值班室交接' };
    }
    if (!game.power) {
      return {
        ...base,
        enabled: false,
        label: '07 号潮汐自记仪',
        blockedReason: '设备断电 · 需先在泵房西侧合上供电开关'
      };
    }
    if (!game.motor) {
      return {
        ...base,
        label: '启动 07 号潮汐自记仪',
        sublabel: '注意：走纸电机会持续发声吸引水下声源'
      };
    }
    if (game.motorProgress < 24) {
      const rem = Math.ceil(24 - game.motorProgress);
      return {
        ...base,
        enabled: false,
        busy: true,
        label: `自记仪正在出卷（剩余 ${rem} 秒）`,
        blockedReason: '走纸未完成 · 用录放机诱饵把水下声源引离机器'
      };
    }
    const threatDist = Math.hypot(game.threat.x - 0, game.threat.z - (-45));
    if (threatDist < 3.8) {
      return {
        ...base,
        enabled: false,
        label: '取走最后一卷记录纸（受阻）',
        blockedReason: '水下声源就在机器下方！先往远处放诱饵引开它'
      };
    }
    return {
      ...base,
      label: '取走最后一卷记录纸',
      sublabel: '走纸已完成 · 取卷后沿原路撤回值班室'
    };
  }

  if (id.startsWith('note-')) {
    return { ...base, mode: 'doc', label: it.label || '阅读站内留存记录', sublabel: '阅读期间游戏自动暂停' };
  }

  if (id === 'gauge-upper') {
    if (game.phase === 0) return { ...base, visible: false };
    return { ...base, label: '观察外海水位尺', sublabel: '核对外海退潮刻度线' };
  }

  if (id === 'gauge-lower') {
    return { ...base, label: '从低位复核外海水位尺', sublabel: '对比站内积水与外海水线' };
  }

  if (id === 'pump-listen') {
    return { ...base, label: '短按东侧检修泵试鸣', sublabel: '在安全高处观察水纹如何追随声源' };
  }

  return base;
}

function toVec3(p) {
  return Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { x: p.x, y: p.y, z: p.z };
}

export function pickBestInteractable(game, worldInteractables, colliders = [], currentId = null) {
  const eye = { x: game.player.x, y: game.player.y + 1.63, z: game.player.z };
  const cp = Math.cos(game.pitch);
  const fwd = {
    x: -Math.sin(game.yaw) * cp,
    y: -Math.sin(game.pitch),
    z: -Math.cos(game.yaw) * cp
  };

  const candidates = [...worldInteractables];
  if (game.device) {
    candidates.push({
      id: 'device',
      pos: { x: game.device.pos.x, y: game.device.pos.y + 0.16, z: game.device.pos.z },
      label: '取回便携录放机'
    });
  }

  let best = null;
  let bestScore = Infinity;

  for (const raw of candidates) {
    const state = evaluateInteraction(game, raw);
    if (!state.visible) continue;

    const p = toVec3(raw.pos);
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    const dz = p.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > state.maxDist || dist < 0.05) continue;

    if (state.maxHoriz !== undefined) {
      const horiz = Math.hypot(p.x - game.player.x, p.z - game.player.z);
      if (horiz > state.maxHoriz) continue;
    }

    const along = dx * fwd.x + dy * fwd.y + dz * fwd.z;
    const isHeld = game.holding && game.holding === state.id;
    const maxAngle = isHeld ? 0.52 : 0.37; // ~21.2 deg normal cone, ~29.8 deg while actively holding
    if (along <= 0.05) continue;

    const cosAngle = Math.min(1, Math.max(-1, along / dist));
    const angle = Math.acos(cosAngle);

    // Closest distance from view ray to target sphere center
    const perpSq = Math.max(0, dist * dist - along * along);
    const perp = Math.sqrt(perpSq);
    const effectiveRadius = state.hitRadius + (isHeld ? 0.26 : 0.14);

    if (angle > maxAngle && perp > effectiveRadius) continue;
    if (perp > effectiveRadius * 1.25) continue;

    // Sightline check against walls & floor slabs (test center + slight pull toward eye for flush wall mounts)
    const pull = Math.min(0.09, dist * 0.2);
    const sample = {
      x: p.x - (dx / dist) * pull,
      y: p.y - (dy / dist) * pull,
      z: p.z - (dz / dist) * pull
    };
    if (!hasClearInteractionPath(eye, sample, colliders) && !hasClearInteractionPath(eye, p, colliders)) {
      continue;
    }

    // Screen-center alignment is primary; distance is secondary; actionable beats passive/completed
    const normAngle = angle / maxAngle;
    const normPerp = perp / effectiveRadius;
    const centerMetric = Math.min(normAngle, normPerp * 0.85) * 0.65 + normAngle * 0.35;
    const distMetric = (dist / state.maxDist) * 0.20;
    const statePenalty = state.enabled ? 0 : (state.completed ? 0.42 : 0.18);
    const priorityBonus = (1 - state.priority) * 0.25;
    const hysteresis = (currentId === state.id ? -0.07 : 0) + (isHeld ? -0.22 : 0);

    const score = centerMetric + distMetric + statePenalty + priorityBonus + hysteresis;
    if (score < bestScore) {
      bestScore = score;
      best = { ...raw, pos: p, state };
    }
  }

  return best;
}
