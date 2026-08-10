/**
 * public/scripts/multiSelectPromoFilter.js
 * Gerencia a Combobox Multi-Seleção (com checkboxes e busca) para o filtro de Nome da Promoção.
 */
class MultiSelectPromoFilter {
    constructor(config) {
        this.btnId = config.btnId;
        this.dropdownId = config.dropdownId;
        this.listId = config.listId;
        this.placeholder = config.placeholder || 'Todas as Promoções';
        this.onFilterChange = config.onFilterChange || (() => {});

        this.btn = document.getElementById(this.btnId);
        this.dropdown = document.getElementById(this.dropdownId);
        this.listContainer = document.getElementById(this.listId);

        if (!this.btn || !this.dropdown || !this.listContainer) {
            console.warn('[MultiSelectPromoFilter] Elementos do filtro não encontrados:', config);
            return;
        }

        this.btnText = this.btn.querySelector('.multi-select-btn-text');
        this.badge = this.btn.querySelector('.multi-select-badge');
        this.searchInput = this.dropdown.querySelector('.multi-select-search');
        this.btnSelectAll = this.dropdown.querySelector('.btn-select-all');
        this.btnClearAll = this.dropdown.querySelector('.btn-clear-all');
        this.btnApply = this.dropdown.querySelector('.btn-apply-filter');
        this.btnClear = this.dropdown.querySelector('.btn-clear-filter');

        this.selectedNames = new Set();
        this.allOptionNames = [];
        this.isOpen = false;

        this._bindEvents();
    }

    _bindEvents() {
        // Toggle dropdown
        this.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        // Previne fechamento ao clicar dentro do menu
        this.dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Fechar ao clicar fora
        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.dropdown.contains(e.target) && !this.btn.contains(e.target)) {
                this.closeDropdown();
            }
        });

        // Busca rápida no dropdown
        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => {
                const term = this.searchInput.value.toLowerCase().trim();
                const items = this.listContainer.querySelectorAll('.multi-select-item');
                items.forEach(item => {
                    const text = item.querySelector('.multi-select-item-label').textContent.toLowerCase();
                    item.style.display = text.includes(term) ? 'flex' : 'none';
                });
            });
        }

        // Selecionar Tudo
        if (this.btnSelectAll) {
            this.btnSelectAll.addEventListener('click', () => {
                this.selectAll();
            });
        }

        // Limpar Seleção
        if (this.btnClearAll) {
            this.btnClearAll.addEventListener('click', () => {
                this.clearAll();
            });
        }

        // Botão Limpar do Footer
        if (this.btnClear) {
            this.btnClear.addEventListener('click', () => {
                this.clearAll();
                this.closeDropdown();
            });
        }

        // Botão Aplicar do Footer
        if (this.btnApply) {
            this.btnApply.addEventListener('click', () => {
                this.closeDropdown();
                this.onFilterChange();
            });
        }
    }

    toggleDropdown() {
        if (this.isOpen) {
            this.closeDropdown();
        } else {
            this.openDropdown();
        }
    }

    openDropdown() {
        this.isOpen = true;
        this.dropdown.style.display = 'block';
        if (this.btn.parentElement) {
            this.btn.parentElement.classList.add('open');
        }
        if (this.searchInput) {
            this.searchInput.value = '';
            this.searchInput.focus();
            const items = this.listContainer.querySelectorAll('.multi-select-item');
            items.forEach(item => item.style.display = 'flex');
        }
    }

    closeDropdown() {
        this.isOpen = false;
        this.dropdown.style.display = 'none';
        if (this.btn.parentElement) {
            this.btn.parentElement.classList.remove('open');
        }
    }

    setOptions(options) {
        // options: Array de { name: string, count?: number }
        const incomingNames = options.map(o => typeof o === 'string' ? o : o.name).filter(Boolean);

        // Adiciona novos nomes ao conjunto mestre de nomes conhecidos
        incomingNames.forEach(name => {
            if (!this.allOptionNames.includes(name)) {
                this.allOptionNames.push(name);
            }
        });
        this.allOptionNames.sort((a, b) => a.localeCompare(b, 'pt-BR'));

        this.renderList(options);
        this.updateButtonLabel();
    }

    renderList(options) {
        if (!this.listContainer) return;
        this.listContainer.innerHTML = '';

        if (this.allOptionNames.length === 0) {
            this.listContainer.innerHTML = '<div style="font-size:0.78rem; color:#888; text-align:center; padding:10px;">Nenhuma promoção encontrada</div>';
            return;
        }

        const countsMap = {};
        options.forEach(o => {
            if (typeof o === 'object' && o.name) {
                countsMap[o.name] = o.count;
            }
        });

        this.allOptionNames.forEach((name, idx) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'multi-select-item';

            const safeId = `chk_promo_${idx}_${Math.random().toString(36).substr(2, 4)}`;
            const isChecked = this.selectedNames.has(name);
            const countVal = countsMap[name] != null ? countsMap[name] : 0;
            const countStr = `(${countVal})`;

            itemDiv.innerHTML = `
                <input type="checkbox" id="${safeId}" ${isChecked ? 'checked' : ''} value="${escapeHtml(name)}" />
                <label for="${safeId}" class="multi-select-item-label" title="${escapeHtml(name)}">${escapeHtml(name)}</label>
                <span class="multi-select-item-count">${countStr}</span>
            `;

            const checkbox = itemDiv.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selectedNames.add(name);
                } else {
                    this.selectedNames.delete(name);
                }
                this.updateButtonLabel();
                this.onFilterChange();
            });

            this.listContainer.appendChild(itemDiv);
        });
    }

    selectAll() {
        this.selectedNames = new Set(this.allOptionNames);
        const checkboxes = this.listContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(chk => chk.checked = true);
        this.updateButtonLabel();
        this.onFilterChange();
    }

    clearAll() {
        this.selectedNames.clear();
        const checkboxes = this.listContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(chk => chk.checked = false);
        this.updateButtonLabel();
        this.onFilterChange();
    }

    updateButtonLabel() {
        if (!this.btnText) return;

        const count = this.selectedNames.size;
        const total = this.allOptionNames.length;

        if (count === 0 || count === total) {
            this.btnText.textContent = this.placeholder;
            if (this.badge) this.badge.style.display = 'none';
        } else if (count === 1) {
            const firstName = Array.from(this.selectedNames)[0];
            this.btnText.textContent = firstName;
            if (this.badge) {
                this.badge.textContent = '1';
                this.badge.style.display = 'inline-block';
            }
        } else {
            this.btnText.textContent = `${count} Promoções Selecionadas`;
            if (this.badge) {
                this.badge.textContent = String(count);
                this.badge.style.display = 'inline-block';
            }
        }
    }

    getSelectedNames() {
        return Array.from(this.selectedNames);
    }

    hasFilter() {
        return this.selectedNames.size > 0 && this.selectedNames.size < this.allOptionNames.length;
    }

    matches(promoName) {
        if (!this.hasFilter()) return true;
        if (!promoName) return false;
        return this.selectedNames.has(promoName);
    }

    matchesAny(promoNamesArray) {
        if (!this.hasFilter()) return true;
        if (!Array.isArray(promoNamesArray) || promoNamesArray.length === 0) return false;
        return promoNamesArray.some(name => this.selectedNames.has(name));
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
