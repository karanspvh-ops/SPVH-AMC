import sys
import os

def create_about():
    with open('index.html', 'r', encoding='utf-8') as f:
        html = f.read()
    
    head_end = html.find('</head>') + 7
    head_content = html[:head_end]
    
    header_start = html.find('<header id="header">')
    header_end = html.find('</header>') + 9
    header_content = html[header_start:header_end]
    
    footer_start = html.find('<!-- Footer -->')
    if footer_start == -1:
        footer_start = html.find('<footer class="footer-new">')
    footer_end = html.find('</footer>') + 9
    footer_content = html[footer_start:footer_end]
    
    about_html = f"""{head_content}
<body>
  {header_content}
  <main>
    <!-- About Hero Banner -->
    <section class="about-hero-new">
      <div class="cta-abstract-overlay"></div>
      <div class="container hero-container" style="position: relative; z-index: 2;">
        <div class="about-hero-content reveal">
          <span class="about-hero-label">OUR STORY</span>
          <h1 class="about-hero-title">More Than an Asset Manager.<br><span style="color: #47a996;">A Legacy in the Making.</span></h1>
          <div class="about-hero-accent"></div>
        </div>
      </div>
    </section>

    <!-- Section 1: The SPVH Story -->
    <section class="story-section">
      <div class="container">
        <div class="story-grid">
          <div class="story-content reveal">
            <h2 class="story-title">From a Vision to a Trusted Institution.</h2>
            <div class="story-accent"></div>
            <p>SPVH Group was founded with a singular vision — to build enduring value across generations. What began as a diversified holding company has evolved into one of India's emerging institutional investment platforms.</p>
            <p>SPVH Asset Management Company was established as the dedicated investment arm of the Group, bringing the same long-term, conviction-driven philosophy that has defined the SPVH Group's own wealth creation journey.</p>
            <p>Today we serve family offices, HNIs, and institutional investors across India — combining research depth, risk discipline, and client-first thinking.</p>
          </div>
          <div class="story-visual reveal-right">
            <div class="story-image"></div>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 2: Our Values -->
    <section class="values-section" style="background-color: #0A1628;">
      <div class="container">
        <div class="values-header text-center reveal">
          <h2 class="values-title">The Principles That <span>Define Us.</span></h2>
        </div>
        <div class="values-grid reveal" style="animation-delay: 0.2s;">
          <div class="value-card">
            <i class="fas fa-shield-alt value-icon"></i>
            <h3>Integrity First</h3>
            <p>We never compromise on transparency or fiduciary responsibility.</p>
          </div>
          <div class="value-card">
            <i class="fas fa-search value-icon"></i>
            <h3>Research Driven</h3>
            <p>Every decision is backed by rigorous analysis, not market noise.</p>
          </div>
          <div class="value-card">
            <i class="fas fa-handshake value-icon"></i>
            <h3>Client Obsessed</h3>
            <p>Your goals are our mandate. Nothing else comes first.</p>
          </div>
          <div class="value-card">
            <i class="fas fa-hourglass-half value-icon"></i>
            <h3>Long Term Thinking</h3>
            <p>We invest like it's our own capital — patiently and with conviction.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 3: SPVH Group Overview -->
    <section class="group-overview-section">
      <div class="container">
        <div class="group-grid">
          <div class="group-visual reveal-left">
            <div class="group-image"></div>
          </div>
          <div class="group-content reveal">
            <h2 class="group-title">The SPVH Group &mdash; A Legacy of Value Creation.</h2>
            <p>SPVH Asset Management Company is part of the broader SPVH Group — a multi-generational holding company with interests spanning technology, logistics, and real estate. The Group's investment philosophy and long-term orientation forms the bedrock of everything we do at SPVHAMC.</p>
            
            <div class="group-stats-grid">
              <div class="group-stat-box">
                <div class="stat-accent"></div>
                <div class="stat-number">Group Est. 1998</div>
              </div>
              <div class="group-stat-box">
                <div class="stat-accent"></div>
                <div class="stat-number">25+ Years of Operations</div>
              </div>
              <div class="group-stat-box">
                <div class="stat-accent"></div>
                <div class="stat-number">12 Group Companies</div>
              </div>
              <div class="group-stat-box">
                <div class="stat-accent"></div>
                <div class="stat-number">₹8,500 Cr Group AUM</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Bottom CTA -->
    <section class="pre-footer-cta-new" style="background-color: #0A1628; padding: 100px 0; position: relative; overflow: hidden;">
      <div class="cta-abstract-overlay"></div>
      <div class="container" style="position: relative; z-index: 2;">
        <div class="cta-content-wrapper text-center">
          <h2 class="cta-heading reveal">Meet the Team Behind SPVH</h2>
          <a href="team.html" class="btn-cta-primary reveal-pop" style="margin-top: 2rem;">Overview of Leadership &rarr;</a>
        </div>
      </div>
    </section>

  </main>

  {footer_content}
  <script src="script.js"></script>
</body>
</html>"""
    with open('about.html', 'w', encoding='utf-8') as f:
        f.write(about_html)

create_about()
