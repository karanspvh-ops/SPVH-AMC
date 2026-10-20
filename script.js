document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('js-ready');

  // ── Disclaimer Popup ──────────────────────────────────────
  (function() {
    if (localStorage.getItem('spvh_disclaimer_accepted')) return;

    var overlay = document.createElement('div');
    overlay.id = 'disclaimerOverlay';
    overlay.innerHTML = '' +
      '<div class="disc-banner" id="discBanner">' +
        '<div class="disc-header">' +
          '<div class="disc-icon"><i class="fas fa-shield-halved"></i></div>' +
          '<span class="disc-title">Important Notice</span>' +
        '</div>' +
        '<ul class="disc-list">' +
          '<li>The content on this website is for <strong>informational purposes only</strong> and does not constitute investment advice, an offer to sell, or a solicitation to buy any securities or investment products.</li>' +
          '<li><strong>Past performance is not indicative of future results.</strong> Investments in securities markets are subject to market risks. Please read all related documents carefully before investing.</li>' +
          '<li>SPVH AMC Private Limited is currently <strong>undergoing regulatory filing with SEBI</strong> for the procurement of licenses pertaining to investment intermediation, including RA, IA, PMS, and offshore fund structures regulated under GIFT City IFSC.</li>' +
          '<li>Any model portfolio or track record data presented on this website is for <strong>illustrative purposes only</strong> and does not represent actual client accounts.</li>' +
        '</ul>' +
        '<p class="disc-consent">By proceeding, you confirm that you have read and understood this disclaimer and agree to the terms and conditions governing the use of this website.</p>' +
        '<div class="disc-actions">' +
          '<button class="disc-accept" id="discAccept">I Understand &amp; Agree</button>' +
          '<button class="disc-decline" id="discDecline">Decline</button>' +
        '</div>' +
        '<p class="disc-links">Read our full <a href="privacy-policy">Privacy Policy</a> · <a href="disclaimer">Disclaimer</a> · <a href="regulatory">Regulatory Information</a></p>' +
      '</div>';

    var style = document.createElement('style');
    style.textContent = '' +
      '#disclaimerOverlay{position:fixed;inset:0;z-index:99999;background:rgba(6,14,30,0.55);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity 0.35s ease;}' +
      '#disclaimerOverlay.active{opacity:1;}' +
      '.disc-banner{background:#fff;border-radius:18px 18px 0 0;max-width:640px;width:100%;padding:1.75rem 2rem 1.5rem;box-shadow:0 -12px 50px rgba(0,0,0,0.25);transform:translateY(100%);transition:transform 0.4s cubic-bezier(0.16,1,0.3,1);}' +
      '#disclaimerOverlay.active .disc-banner{transform:translateY(0);}' +
      '.disc-header{display:flex;align-items:center;gap:10px;margin-bottom:1rem;}' +
      '.disc-icon{width:34px;height:34px;border-radius:8px;background:#EEF2F8;display:flex;align-items:center;justify-content:center;color:#496bad;font-size:0.9rem;}' +
      '.disc-title{font-family:"Montserrat",sans-serif;font-size:1rem;font-weight:700;color:#0A1628;}' +
      '.disc-list{padding-left:1.15rem;margin:0 0 0.75rem;}' +
      '.disc-list li{font-size:0.78rem;color:#475569;line-height:1.75;margin-bottom:0.35rem;}' +
      '.disc-list li strong{color:#0A1628;font-weight:600;}' +
      '.disc-consent{font-size:0.72rem;color:#94A3B8;line-height:1.65;margin:0 0 1.25rem;font-style:italic;}' +
      '.disc-actions{display:flex;gap:10px;margin-bottom:0.75rem;}' +
      '.disc-accept{flex:1;background:#0A1628;color:#fff;border:none;padding:12px 0;border-radius:8px;font-family:"Montserrat",sans-serif;font-size:0.82rem;font-weight:600;cursor:pointer;transition:background 0.2s;}' +
      '.disc-accept:hover{background:#1a3560;}' +
      '.disc-decline{background:#F0F4FA;color:#64748B;border:none;padding:12px 22px;border-radius:8px;font-family:"Montserrat",sans-serif;font-size:0.82rem;font-weight:600;cursor:pointer;transition:background 0.2s;}' +
      '.disc-decline:hover{background:#E2E8F0;}' +
      '.disc-links{font-size:0.65rem;color:#94A3B8;text-align:center;margin:0;}' +
      '.disc-links a{color:#496bad;text-decoration:none;}' +
      '.disc-links a:hover{text-decoration:underline;}' +
      '@keyframes discShake{0%,100%{transform:translateX(0)}15%{transform:translateX(-8px)}30%{transform:translateX(7px)}45%{transform:translateX(-5px)}60%{transform:translateX(4px)}75%{transform:translateX(-2px)}}' +
      '.disc-shake{animation:discShake 0.5s ease-in-out;}' +
      '@media(max-width:640px){.disc-banner{padding:1.5rem 1.25rem 1.25rem;border-radius:14px 14px 0 0;}.disc-list li{font-size:0.73rem;}.disc-actions{flex-direction:column;}.disc-accept,.disc-decline{width:100%;}}';

    document.head.appendChild(style);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        overlay.classList.add('active');
      });
    });

    document.getElementById('discAccept').addEventListener('click', function() {
      try { localStorage.setItem('spvh_disclaimer_accepted', '1'); } catch(e) {}
      overlay.classList.remove('active');
      document.body.style.overflow = '';
      setTimeout(function() { overlay.remove(); style.remove(); }, 400);
    });

    document.getElementById('discDecline').addEventListener('click', function() {
      var banner = document.getElementById('discBanner');
      banner.classList.remove('disc-shake');
      void banner.offsetWidth;
      banner.classList.add('disc-shake');
    });
  })();

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
