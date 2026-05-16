document.addEventListener('DOMContentLoaded', () => {
  const header = document.getElementById('header');
  
  // Sticky Header Transition
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      header.style.boxShadow = '0 25px 60px -10px rgba(0,0,0,0.2)';
    } else {
      header.style.boxShadow = '0 10px 40px rgba(0, 0, 0, 0.05)';
    }
  });

  // Reveal Animations
  const revealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-pop');
  
  const revealOnScroll = () => {
    const windowHeight = window.innerHeight;
    revealElements.forEach(el => {
      const elementTop = el.getBoundingClientRect().top;
      if (elementTop < windowHeight - 80) {
        el.classList.add('active');
        
        // Trigger Counter on Reveal
        if (el.classList.contains('stat-box') && !el.classList.contains('counted')) {
          el.classList.add('counted');
          const counterObj = el.querySelector('.counter');
          if(counterObj) animateCounter(counterObj);
        }
      }
    });
  };

  window.addEventListener('scroll', revealOnScroll);
  revealOnScroll(); // Trigger immediately on load

  // Counter Number Animation Logic
  function animateCounter(counter) {
    const target = +counter.getAttribute('data-target');
    const duration = +(counter.getAttribute('data-duration') || 4000);
    const steps = duration / 20;
    const inc = target / steps;
    
    const updateCount = () => {
      const current = +counter.innerText;
      
      if (current < target) {
        let next = Math.ceil(current + inc);
        if (next > target) next = target;
        counter.innerText = next;
        setTimeout(updateCount, 20);
      } else {
        counter.innerText = target;
      }
    };
    
    updateCount();
  }

  // Mobile Menu — class-based toggle (styles live in responsive.css)
  const hamburger = document.querySelector('.hamburger');
  const navMenu = document.querySelector('.nav-menu');
  const navActions = document.querySelector('.nav-actions');

  const closeMenu = () => {
    navMenu.classList.remove('nav-open');
    navActions.classList.remove('nav-open');
    hamburger.classList.remove('active');
    document.body.classList.remove('menu-open');
  };

  if (hamburger) {
    hamburger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = navMenu.classList.contains('nav-open');
      isOpen ? closeMenu() : (() => {
        navMenu.classList.add('nav-open');
        navActions.classList.add('nav-open');
        hamburger.classList.add('active');
        document.body.classList.add('menu-open');
      })();
    });

    // Close when clicking outside the header
    document.addEventListener('click', (e) => {
      if (!e.target.closest('header') && navMenu.classList.contains('nav-open')) {
        closeMenu();
      }
    });

    // Mobile submenu accordion — tap parent link to expand/collapse
    navMenu.querySelectorAll('.nav-item > a').forEach(link => {
      link.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
          const parent = link.parentElement;
          if (parent.querySelector('.dropdown-menu')) {
            e.preventDefault();
            parent.classList.toggle('submenu-open');
          } else {
            closeMenu();
          }
        }
      });
    });

    // Close menu when viewport grows back to desktop
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) closeMenu();
    });
  }

  // --- Performance Chart Logic ---
  const perfCanvas = document.getElementById('performanceChart');
  if (perfCanvas) {
    const ctx = perfCanvas.getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'],
        datasets: [
          {
            label: 'SPVH Equity PMS',
            data: [100, 122.8, 158.4, 192.3, 222.8],
            borderColor: '#496bad',
            backgroundColor: 'rgba(73, 107, 173, 0.1)',
            borderWidth: 3,
            tension: 0.4,
            fill: true,
            pointBackgroundColor: '#496bad',
            pointRadius: 4,
          },
          {
            label: 'Benchmark (Nifty 50)',
            data: [100, 114.8, 134.1, 150.2, 174.8],
            borderColor: '#47a996',
            borderWidth: 2,
            borderDash: [5, 5],
            tension: 0.4,
            fill: false,
            pointBackgroundColor: '#47a996',
            pointRadius: 0,
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              font: { family: 'Helvetica' }
            }
          }
        },
        scales: {
          y: {
            grid: { color: '#E5EAF2' },
            ticks: { font: { family: 'Helvetica', size: 11 } }
          },
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Helvetica', size: 11 } }
          }
        }
      }
    });
  }

  // --- Testimonial Carousel Logic ---
  const track = document.getElementById('testimonialTrack');
  if (track) {
    const cards = Array.from(track.children);
    const nextButton = document.querySelector('.next-btn');
    const prevButton = document.querySelector('.prev-btn');
    const dotsNav = document.getElementById('carouselDots');
    
    // Calculate how many cards are visible
    const getCardsPerView = () => {
      if (window.innerWidth <= 768) return 1;
      return 3;
    };
    
    let cardsPerView = getCardsPerView();
    let maxIndex = Math.max(0, cards.length - cardsPerView);
    let currentIndex = 0;

    // Generate dots dynamically based on available sliding steps
    const updateDots = () => {
      dotsNav.innerHTML = '';
      for (let i = 0; i <= maxIndex; i++) {
        const dot = document.createElement('button');
        dot.classList.add('carousel-dot');
        if (i === currentIndex) dot.classList.add('active');
        dot.dataset.index = i;
        dotsNav.appendChild(dot);
      }
    };
    updateDots();

    const updateSlider = () => {
      const cardWidth = track.getBoundingClientRect().width / cardsPerView;
      track.style.transform = `translateX(-${currentIndex * cardWidth}px)`;
      Array.from(dotsNav.children).forEach((dot, index) => {
        dot.classList.toggle('active', index === currentIndex);
      });
    };

    window.addEventListener('resize', () => {
      cardsPerView = getCardsPerView();
      maxIndex = Math.max(0, cards.length - cardsPerView);
      if (currentIndex > maxIndex) currentIndex = maxIndex;
      updateDots();
      updateSlider();
    });

    nextButton.addEventListener('click', () => {
      currentIndex = currentIndex < maxIndex ? currentIndex + 1 : 0;
      updateSlider();
    });

    prevButton.addEventListener('click', () => {
      currentIndex = currentIndex > 0 ? currentIndex - 1 : maxIndex;
      updateSlider();
    });

    dotsNav.addEventListener('click', e => {
      const targetDot = e.target.closest('button');
      if (!targetDot) return;
      currentIndex = parseInt(targetDot.dataset.index);
      updateSlider();
    });

    // Auto-scroll logic with pause on hover
    let autoScroll = setInterval(() => {
      nextButton.click();
    }, 5000);

    const wrapper = document.querySelector('.carousel-wrapper');
    wrapper.addEventListener('mouseenter', () => clearInterval(autoScroll));
  }

  // --- VDF Portfolio Donut Chart ---
  const vdfCanvas = document.getElementById('vdfPortfolioChart');
  if (vdfCanvas) {
    const ctx = vdfCanvas.getContext('2d');
    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Pre-IPO Placement', 'Anchor Book', 'Public Equities'],
        datasets: [{
          data: [60, 25, 15],
          backgroundColor: [
            '#496bad',
            '#47a996',
            '#E5E7EB'
          ],
          borderWidth: 5,
          borderColor: '#ffffff',
          hoverOffset: 15,
        }]
      },
      options: {
        responsive: true,
        cutout: '75%',
        plugins: {
          legend: {
            display: false // We use custom HTML legend
          },
          tooltip: {
            backgroundColor: '#0A1628',
            titleFont: { size: 14, family: 'Helvetica' },
            bodyFont: { size: 16, weight: 'bold', family: 'Helvetica' },
            padding: 15,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              label: function(context) {
                return ' ' + context.raw + '%';
              }
            }
          }
        },
        animation: {
          animateScale: true,
          animateRotate: true
        }
      }
    });
  }

});
