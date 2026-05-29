const bgImgWrap = document.getElementById('bg-img-wrap');
const bgLayer   = document.getElementById('bg-layer');

function loadBG(e) {
  const file = e.target.files[0]; if (!file) return;
  const url = URL.createObjectURL(file);
  bgImgWrap.innerHTML = '';
  const img = document.createElement('img');
  img.src = url;
  bgImgWrap.appendChild(img);
  bgLayer.style.backgroundImage = 'none';
  e.target.value = '';
}

function clearBG() {
  bgImgWrap.innerHTML = '';
  bgLayer.style.backgroundImage = `
    linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)`;
}

document.addEventListener('click', e => {
  hideCtx();
  if (!e.target.closest('.token')) select(null);
});

document.addEventListener('keydown', e => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null) {
    if (document.activeElement.tagName === 'INPUT') return;
    ctxTarget = selectedId;
    ctxDelete();
  }
});

// Demo tokens
spawnToken({ id: nextId++, name: 'Aldric',  color: '#2a6aaa', type: 'hero',  x: 220, y: 240, size: 54 });
spawnToken({ id: nextId++, name: 'Lyria',   color: '#7a3aaa', type: 'hero',  x: 320, y: 300, size: 54 });
spawnToken({ id: nextId++, name: 'Goblin',  color: '#882222', type: 'enemy', x: 580, y: 240, size: 54 });
spawnToken({ id: nextId++, name: 'Troll',   color: '#554422', type: 'enemy', x: 660, y: 340, size: 70 });
hint.style.display = 'none';
