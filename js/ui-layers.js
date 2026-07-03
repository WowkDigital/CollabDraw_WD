// Layers Panel UI Rendering and Actions helper

export function renderLayersList(ui) {
  if (!ui.layersListContainer) return;
  ui.layersListContainer.innerHTML = '';
  
  // Z-index list in Yjs goes bottom to top, so reverse for natural look
  const layerIds = ui.sync.yLayerOrder.toArray().slice().reverse();

  layerIds.forEach((layerId, idx) => {
    const yLayer = ui.sync.yLayers.get(layerId);
    if (!yLayer) return;

    const layerData = yLayer.toJSON();
    const isActive = ui.canvas.activeLayerId === layerId;

    const item = document.createElement('div');
    item.className = `flex items-center justify-between p-3 rounded-xl border transition-all duration-200 cursor-pointer ${
      isActive 
        ? 'bg-brand-600/10 border-brand-500/50 shadow-md shadow-brand-500/5' 
        : 'bg-slate-900 border-slate-800/80 hover:border-slate-700/80'
    }`;

    // Click to select active layer
    item.addEventListener('click', (e) => {
      // Prevent click when user interacts with action buttons
      if (e.target.closest('button') || e.target.closest('input')) return;
      ui.canvas.setActiveLayer(layerId);
      ui.renderLayersList();
    });

    // Left panel: active check dot and renameable layer title
    const infoContainer = document.createElement('div');
    infoContainer.className = 'flex items-center gap-2.5 flex-grow pr-2 min-w-0';

    const activeDot = document.createElement('div');
    activeDot.className = `w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-brand-500 shadow shadow-brand-500/50 animate-pulse' : 'bg-slate-700'}`;

    const nameLabel = document.createElement('span');
    nameLabel.className = `text-xs truncate font-medium ${isActive ? 'text-slate-100' : 'text-slate-300'}`;
    nameLabel.textContent = layerData.name;

    // Handle Double Click to Rename
    nameLabel.addEventListener('dblclick', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = layerData.name;
      input.className = 'bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-medium text-slate-100 focus:outline-none focus:border-brand-500 w-full';
      
      const saveRename = () => {
        const newName = input.value.trim();
        if (newName && newName !== layerData.name) {
          ui.canvas.setLayerName(layerId, newName);
          ui.sync.updateLayerProperty(layerId, 'name', newName);
          ui.renderLayersList();
        } else {
          ui.renderLayersList();
        }
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveRename();
        if (e.key === 'Escape') ui.renderLayersList();
      });
      input.addEventListener('blur', saveRename);

      infoContainer.replaceChild(input, nameLabel);
      input.focus();
      input.select();
    });

    infoContainer.appendChild(activeDot);
    infoContainer.appendChild(nameLabel);

    // Right panel: Up, Down, Visibility Eye, and Delete Garbage Can
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'flex items-center gap-1.5 shrink-0';

    // Move Up (higher index, overlaying on top)
    const upBtn = document.createElement('button');
    upBtn.className = 'p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded flex items-center justify-center';
    upBtn.disabled = idx === 0;
    upBtn.style.opacity = idx === 0 ? '0.3' : '1';
    upBtn.innerHTML = `
      <i data-lucide="chevron-up" class="w-3.5 h-3.5"></i>
    `;
    upBtn.addEventListener('click', () => {
      const order = ui.sync.yLayerOrder.toArray();
      const orderIndex = order.length - 1 - idx;
      if (orderIndex < order.length - 1) {
        // Swap with element above (index + 1)
        const temp = order[orderIndex];
        order[orderIndex] = order[orderIndex + 1];
        order[orderIndex + 1] = temp;
        ui.sync.reorderLayers(order);
        ui.canvas.reorderLayers(order);
        ui.renderLayersList();
      }
    });

    // Move Down (lower index, below underneath)
    const downBtn = document.createElement('button');
    downBtn.className = 'p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded flex items-center justify-center';
    downBtn.disabled = idx === layerIds.length - 1;
    downBtn.style.opacity = idx === layerIds.length - 1 ? '0.3' : '1';
    downBtn.innerHTML = `
      <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>
    `;
    downBtn.addEventListener('click', () => {
      const order = ui.sync.yLayerOrder.toArray();
      const orderIndex = order.length - 1 - idx;
      if (orderIndex > 0) {
        // Swap with element below (index - 1)
        const temp = order[orderIndex];
        order[orderIndex] = order[orderIndex - 1];
        order[orderIndex - 1] = temp;
        ui.sync.reorderLayers(order);
        ui.canvas.reorderLayers(order);
        ui.renderLayersList();
      }
    });

    // Eye visibility toggle
    const visBtn = document.createElement('button');
    visBtn.className = `p-1 hover:bg-slate-800 rounded flex items-center justify-center ${layerData.visible ? 'text-slate-300' : 'text-slate-500'}`;
    visBtn.innerHTML = layerData.visible
      ? `<i data-lucide="eye" class="w-3.5 h-3.5"></i>`
      : `<i data-lucide="eye-off" class="w-3.5 h-3.5"></i>`;
    
    visBtn.addEventListener('click', () => {
      const nextVisible = !layerData.visible;
      ui.canvas.setLayerVisibility(layerId, nextVisible);
      ui.sync.updateLayerProperty(layerId, 'visible', nextVisible);
      ui.renderLayersList();
    });

    // Trash delete
    const delBtn = document.createElement('button');
    delBtn.className = 'p-1 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 rounded flex items-center justify-center';
    delBtn.innerHTML = `
      <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
    `;
    delBtn.addEventListener('click', () => {
      if (ui.sync.yLayerOrder.length <= 1) {
        alert('You cannot delete the last layer. At least one layer is required.');
        return;
      }
      if (confirm(`Are you sure you want to delete the layer "${layerData.name}"?`)) {
        ui.canvas.deleteLayer(layerId);
        ui.sync.deleteLayer(layerId);
        ui.renderLayersList();
      }
    });

    actionsContainer.appendChild(upBtn);
    actionsContainer.appendChild(downBtn);
    actionsContainer.appendChild(visBtn);
    actionsContainer.appendChild(delBtn);

    item.appendChild(infoContainer);
    item.appendChild(actionsContainer);
    ui.layersListContainer.appendChild(item);
  });

  // Refresh dynamic Lucide icons inside the layers list
  if (window.lucide) {
    window.lucide.createIcons();
  }
}
