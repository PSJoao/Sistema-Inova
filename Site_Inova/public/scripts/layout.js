document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    const pageWrapper = document.getElementById('pageWrapper'); // Usaremos para ajustar margens
    const moduleToggles = document.querySelectorAll('.sidebar-nav .module-toggle');

    // 1. Funcionalidade de Toggle da Sidebar Principal
    if (sidebarToggleBtn && sidebar && pageWrapper) {
        sidebarToggleBtn.addEventListener('click', function () {
            sidebar.classList.toggle('collapsed'); // Para o estado colapsado (desktop/ícones)
            pageWrapper.classList.toggle('sidebar-collapsed'); // Para ajustar a margem do conteúdo

            // Para o comportamento mobile de abrir/fechar (overlay)
            // A classe 'open' é mais relevante para o CSS mobile que faz a sidebar deslizar
            if (window.innerWidth <= 768) { // Mesmo breakpoint do CSS
                sidebar.classList.toggle('open'); 
                // Adicionar/remover um overlay para fechar ao clicar fora
                toggleOverlay(sidebar.classList.contains('open'));
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


    // 2. Funcionalidade de Acordeão para Submenus
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

    // 3. (Opcional) Marcar link ativo na sidebar baseado na URL atual
    // Esta é uma implementação simples. Pode precisar de ajustes dependendo da estrutura das suas URLs.
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
                    // Adiciona 'active' também ao link principal do módulo
                    const moduleToggleLink = parentModule.querySelector('.module-toggle');
                    if (moduleToggleLink) {
                       // moduleToggleLink.classList.add('active'); // Opcional: destacar o módulo pai também
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

    // Adiciona um pouco de CSS para o overlay (você pode mover para um arquivo CSS)
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
            z-index: 1008; /* Abaixo da sidebar, acima do conteúdo */
        }
    `;
    document.head.appendChild(style);

});

function playAlarmSound() {
    // Cria um novo objeto de áudio, apontando para o seu ficheiro de som.
    // O caminho é relativo à raiz do seu site.
    const alarmAudio = new Audio('/public/sounds/notification.mp3');

    // O método play() retorna uma Promise. Usamos .catch() para lidar com
    // possíveis erros, como restrições de autoplay do navegador.
    alarmAudio.play().catch(error => {
        // O erro é normalmente ignorado se o utilizador ainda não interagiu com a página.
        console.error("Erro ao tentar tocar o som do alarme:", error);
    });
}