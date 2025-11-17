document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    const pageWrapper = document.getElementById('pageWrapper'); // Usaremos para ajustar margens
    const moduleToggles = document.querySelectorAll('.sidebar-nav .module-toggle');

    // 1. Funcionalidade de Toggle da Sidebar Principal (CORRIGIDO)
    if (sidebarToggleBtn && sidebar && pageWrapper) {
        sidebarToggleBtn.addEventListener('click', function () {
            
            // Verifica o tamanho da tela ANTES de decidir o que fazer
            if (window.innerWidth <= 768) { 
                // --- LÓGICA MOBILE (Gaveta) ---
                // A classe 'open' é mais relevante para o CSS mobile que faz a sidebar deslizar
                sidebar.classList.toggle('open'); 
                // Adicionar/remover um overlay para fechar ao clicar fora
                toggleOverlay(sidebar.classList.contains('open'));
            } else {
                // --- LÓGICA DESKTOP (Mini-menu) ---
                // 'collapsed' é para o estado colapsado (desktop/ícones)
                sidebar.classList.toggle('collapsed'); 
                // 'sidebar-collapsed' ajusta a margem do conteúdo
                pageWrapper.classList.toggle('sidebar-collapsed'); 
            }
        });
    }

    // Função para o overlay (usado no mobile para fechar sidebar ao clicar fora)
    let overlay = null;
    function toggleOverlay(show) {
        if (show) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'sidebar-overlay';
                overlay.addEventListener('click', () => {
                    sidebar.classList.remove('open');
                    toggleOverlay(false);
                });
                pageWrapper.appendChild(overlay); // Adiciona ao pageWrapper para cobrir o conteúdo
            }
            overlay.style.display = 'block';
        } else {
            if (overlay) {
                overlay.style.display = 'none';
            }
        }
    }


    // 2. Funcionalidade de Acordeão para Submenus (Sem alterações)
    moduleToggles.forEach(toggle => {
        toggle.addEventListener('click', function (event) {
            event.preventDefault(); // Previne o comportamento padrão do link '#'
            
            const parentModule = this.closest('.nav-module');
            const subMenu = parentModule.querySelector('.sub-menu');

            if (parentModule && subMenu) {
                parentModule.classList.toggle('open');

                if (parentModule.classList.contains('open')) {
                    // Ao abrir, define max-height para a altura real do conteúdo para animar
                    subMenu.style.maxHeight = subMenu.scrollHeight + "px";
                } else {
                    // Ao fechar, redefine max-height para 0
                    subMenu.style.maxHeight = '0';
                }
            }
        });
    });

    // 3. (Opcional) Marcar link ativo na sidebar baseado na URL atual (Sem alterações)
    function setActiveLink() {
        const currentPath = window.location.pathname;
        const sidebarLinks = document.querySelectorAll('.sidebar-nav a');

        sidebarLinks.forEach(link => {
            link.classList.remove('active');
            const linkPath = link.getAttribute('href');

            if (linkPath === currentPath) {
                link.classList.add('active');

                // Se for um link de submenu, abre o módulo pai
                const subMenu = link.closest('.sub-menu');
                if (subMenu) {
                    const parentModule = subMenu.closest('.nav-module');
                    if (parentModule && !parentModule.classList.contains('open')) {
                        parentModule.classList.add('open');
                        subMenu.style.maxHeight = subMenu.scrollHeight + "px";
                    }
                }
            }
        });
         // Caso especial para o Menu Principal
        if (currentPath === '/') {
            const homeLink = document.querySelector('.sidebar-nav a[href="/"]');
            if (homeLink) {
                homeLink.classList.add('active');
            }
        }
    }
    
    setActiveLink(); // Chama ao carregar a página

    // Adiciona um pouco de CSS para o overlay (Sem alterações)
    const style = document.createElement('style');
    style.textContent = `
        .sidebar-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
            z-index: 1004;
        }
    `;
    document.head.appendChild(style);

});

function playAlarmSound() {
    // (Sem alterações)
    const alarmAudio = new Audio('/public/sounds/notification.mp3');
    alarmAudio.play().catch(error => {
        console.error("Erro ao tentar tocar o som do alarme:", error);
    });
}