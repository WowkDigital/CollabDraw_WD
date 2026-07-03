// Peer Cursors and Avatars UI rendering helper

export function updatePeerCursorsAndAvatars(ui, peers) {
  // 1. Update status avatar bubbles
  ui.avatarsContainer.innerHTML = '';
  ui.collaboratorCount.textContent = `${peers.length + 1} active`; // Count + self

  peers.forEach((peer) => {
    const bubble = document.createElement('div');
    bubble.className = 'w-6 h-6 rounded-full border border-slate-900 flex items-center justify-center text-[10px] font-bold text-white shadow';
    bubble.style.backgroundColor = peer.color;
    bubble.textContent = peer.name.charAt(0).toUpperCase();
    bubble.title = peer.name;
    ui.avatarsContainer.appendChild(bubble);
  });

  // 2. Render collaborative cursors overlay
  ui.cursorsOverlay.innerHTML = '';
  peers.forEach((peer) => {
    if (!peer.cursor) return;

    // Project normalized coordinates back to screen positions based on stage zoom/pan
    const stageTransform = ui.canvas.stage.getAbsoluteTransform();
    const screenPos = stageTransform.point({ x: peer.cursor.x, y: peer.cursor.y });

    const cursorDiv = document.createElement('div');
    cursorDiv.className = 'absolute flex flex-col items-start transition-all duration-75 pointer-events-none';
    cursorDiv.style.left = '0px';
    cursorDiv.style.top = '0px';
    cursorDiv.style.transform = `translate3d(${screenPos.x}px, ${screenPos.y}px, 0)`;

    // Cursor arrow SVG
    const cursorSvg = document.createElement('div');
    cursorSvg.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${peer.color}" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="3 3 7.5 21 12 12 21 7.5 3 3"/>
      </svg>
    `;

    // Name bubble tooltip
    const nameTag = document.createElement('div');
    nameTag.className = 'ml-3 mt-1 py-0.5 px-2 rounded-md text-[10px] font-medium text-white shadow-md select-none whitespace-nowrap';
    nameTag.style.backgroundColor = peer.color;
    nameTag.textContent = peer.name;

    cursorDiv.appendChild(cursorSvg);
    cursorDiv.appendChild(nameTag);
    ui.cursorsOverlay.appendChild(cursorDiv);
  });
}
