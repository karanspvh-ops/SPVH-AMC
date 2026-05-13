import os
import re

css_to_add = """
/* ========================================= */
/* INVESTMENT PHILOSOPHY SECTION STYLES      */
/* ========================================= */

.philosophy-page-hero {
  background-color: #0A1628;
  position: relative;
  height: 520px;
  display: flex;
  align-items: center;
  overflow: hidden;
}
.philosophy-page-hero .pattern-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-image: radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px);
  background-size: 20px 20px;
  z-index: 1;
}

.philosophy-grid-section-1 {
  display: flex;
  gap: 40px;
}
.philosophy-grid-section-1-left {
  width: 55%;
}
.philosophy-grid-section-1-right {
  width: 45%;
  display: flex;
  align-items: stretch;
}
.pull-quote-box {
  background-color: #0A1628;
  border-radius: 10px;
  padding: 40px;
  position: relative;
  width: 100%;
}

.pillars-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
}
.pillar-card {
  background-color: white;
  border-radius: 10px;
  padding: 36px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.05);
  transition: all 0.3s ease;
  position: relative;
  border-left: 4px solid transparent;
}
.pillar-card:hover {
  transform: translateY(-6px);
  border-left: 4px solid #47a996;
}
.pillar-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.pillar-number {
  color: #496bad;
  opacity: 0.12;
  font-size: 72px;
  font-weight: 800;
  line-height: 0.8;
  font-family: 'Helvetica', Arial, sans-serif;
}
.pillar-icon {
  color: #47a996;
  font-size: 28px;
}
.pillar-title {
  color: #1A1A1A;
  font-size: 22px;
  font-weight: 700;
  margin-top: 0;
  margin-bottom: 15px;
}
.pillar-accent {
  width: 40px;
  height: 3px;
  background-color: #47a996;
  margin-bottom: 20px;
}
.pillar-desc {
  color: #4b5563;
  font-size: 15px;
  line-height: 1.6;
  margin-bottom: 20px;
}
.pillar-bullets {
  list-style: none;
  padding: 0;
  margin: 0;
}
.pillar-bullets li {
  color: #9CA3AF;
  font-size: 14px;
  margin-bottom: 8px;
  position: relative;
  padding-left: 15px;
}
.pillar-bullets li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #47a996;
}

.timeline-wrapper {
  position: relative;
  max-width: 1000px;
  margin: 0 auto;
}
.timeline-line {
  position: absolute;
  top: 25px;
  left: 10%;
  right: 10%;
  height: 2px;
  background-image: linear-gradient(to right, transparent 50%, #47a996 50%);
  background-size: 15px 100%;
  z-index: 1;
}
.timeline-nodes {
  display: flex;
  justify-content: space-between;
  position: relative;
  z-index: 2;
}
.timeline-step {
  width: 18%;
  text-align: center;
}
.timeline-node {
  width: 50px;
  height: 50px;
  background-color: #496bad;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 700;
  margin: 0 auto 20px auto;
}
.timeline-title {
  color: #1A1A1A;
  font-size: 16px;
  font-weight: 700;
  margin-top: 0;
  margin-bottom: 10px;
}
.timeline-desc {
  color: #9CA3AF;
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
}

.esg-grid {
  display: flex;
  align-items: center;
  gap: 60px;
}
.esg-left {
  width: 50%;
}
.esg-right {
  width: 50%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.esg-title {
  color: white;
  font-size: 40px;
  font-weight: 700;
  margin-top: 0;
  margin-bottom: 1.5rem;
}
.esg-desc {
  color: #9CA3AF;
  font-size: 15px;
  line-height: 1.6;
  margin-bottom: 2rem;
}
.esg-link {
  color: #47a996;
  text-decoration: none;
  font-weight: 600;
  font-size: 16px;
  transition: opacity 0.3s ease;
}
.esg-link:hover {
  opacity: 0.8;
}
.esg-card {
  display: flex;
  align-items: center;
  background-color: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 8px;
  padding: 24px;
}
.esg-icon {
  color: #47a996;
  font-size: 24px;
  margin-right: 24px;
  width: 30px;
  text-align: center;
}
.esg-card-content {
  flex: 1;
}
.esg-card-title {
  color: white;
  font-size: 18px;
  font-weight: 700;
  margin-top: 0;
  margin-bottom: 5px;
}
.esg-card-desc {
  color: #9CA3AF;
  font-size: 14px;
  margin: 0;
}

@media (max-width: 768px) {
  .philosophy-grid-section-1 {
    flex-direction: column;
  }
  .philosophy-grid-section-1-left,
  .philosophy-grid-section-1-right {
    width: 100%;
  }
  .pillars-grid {
    grid-template-columns: 1fr;
  }
  .timeline-nodes {
    flex-direction: column;
    align-items: flex-start;
  }
  .timeline-line {
    top: 0;
    bottom: 0;
    left: 25px;
    width: 2px;
    height: 100%;
    background-image: linear-gradient(to bottom, transparent 50%, #47a996 50%);
    background-size: 100% 15px;
  }
  .timeline-step {
    width: 100%;
    text-align: left;
    display: flex;
    flex-direction: column;
    padding-left: 70px;
    position: relative;
    margin-bottom: 40px;
  }
  .timeline-node {
    position: absolute;
    left: 0;
    top: 0;
    margin: 0;
  }
  .esg-grid {
    flex-direction: column;
  }
  .esg-left, .esg-right {
    width: 100%;
  }
}
"""

with open('styles.css', 'a') as f:
    f.write(css_to_add)

philosophy_html = """
    <!-- Philosophy Hero Banner -->
    <section id="philosophy" class="philosophy-page-hero">
      <div class="pattern-overlay"></div>
      <div class="container" style="position: relative; z-index: 2;">
        <span class="about-hero-label" style="color: #47a996; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 20px;">HOW WE THINK</span>
        <h1 style="color: white; font-size: 52px; font-weight: 700; line-height: 1.1; margin-bottom: 1.5rem; margin-top:0;">Conviction Over Consensus.<br><span style="color: #47a996;">Patience Over Noise.</span></h1>
        <div style="width: 60px; height: 3px; background-color: #47a996;"></div>
      </div>
    </section>

    <!-- Section 1 — Philosophy Overview -->
    <section class="philosophy-overview" style="background-color: white; padding: 100px 0;">
      <div class="container">
        <div class="philosophy-grid-section-1">
          <div class="philosophy-grid-section-1-left reveal">
            <h2 style="color: #496bad; font-size: 40px; font-weight: 700; margin-bottom: 1.5rem; margin-top:0;">We Invest Like It's Our Own Capital.</h2>
            <div style="width: 60px; height: 3px; background-color: #47a996; margin-bottom: 2rem;"></div>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 1rem;">At SPVH AMC, our investment philosophy is not a marketing document &mdash; it is a living framework that governs every rupee we manage. It has been shaped by decades of market experience, multiple economic cycles, and an unwavering commitment to our investors' long-term interests.</p>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 1rem;">We believe that sustainable wealth creation requires three things above all else &mdash; intellectual honesty, research depth, and the courage to be different when the data supports it.</p>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 0;">Our philosophy is not trend-chasing. It is not benchmark-hugging. It is a disciplined, repeatable process designed to compound capital across market cycles.</p>
          </div>
          <div class="philosophy-grid-section-1-right reveal-right">
            <div class="pull-quote-box">
              <div style="color: #47a996; font-size: 80px; font-family: Georgia, serif; line-height: 1; margin-bottom: 10px;">&ldquo;</div>
              <p style="color: white; font-style: italic; font-size: 22px; line-height: 1.5; margin-top: 0; margin-bottom: 1rem;">The stock market is a device for transferring money from the impatient to the patient.</p>
              <div style="color: #9CA3AF; font-size: 14px; margin-bottom: 2rem;">&mdash; Warren Buffett</div>
              <p style="color: #47a996; font-size: 14px; margin-bottom: 0; font-weight: 500;">Our philosophy in three words: Research. Conviction. Patience.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 2 — The Four Pillars -->
    <section class="four-pillars" style="background-color: #F0F4FA; padding: 100px 0;">
      <div class="container">
        <div style="text-align: center; margin-bottom: 4rem;" class="reveal">
          <span style="color: #47a996; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 10px;">OUR PILLARS</span>
          <h2 style="color: #1A1A1A; font-size: 40px; font-weight: 700; margin-top:0; margin-bottom: 0;">Four Pillars of <span style="color: #496bad;">Our Investment Framework.</span></h2>
        </div>

        <div class="pillars-grid reveal">
          <!-- Pillar 1 -->
          <div class="pillar-card">
            <div class="pillar-card-header">
              <span class="pillar-number">01</span>
              <i class="fas fa-search pillar-icon"></i>
            </div>
            <h3 class="pillar-title">Fundamental Research</h3>
            <div class="pillar-accent"></div>
            <p class="pillar-desc">We build our own models. We visit companies. We talk to managements, competitors, and suppliers. Our research is proprietary and deep.</p>
            <ul class="pillar-bullets">
              <li>Bottom-up stock analysis</li>
              <li>Scuttlebutt research methodology</li>
            </ul>
          </div>
          <!-- Pillar 2 -->
          <div class="pillar-card">
            <div class="pillar-card-header">
              <span class="pillar-number">02</span>
              <i class="fas fa-cubes pillar-icon"></i>
            </div>
            <h3 class="pillar-title">Portfolio Construction</h3>
            <div class="pillar-accent"></div>
            <p class="pillar-desc">We build concentrated, high-conviction portfolios. Typically 15&ndash;25 positions in equity strategies. Each position sized by conviction and risk-adjusted return potential.</p>
            <ul class="pillar-bullets">
              <li>Risk-adjusted position sizing</li>
              <li>Sector &amp; macro overlay</li>
            </ul>
          </div>
          <!-- Pillar 3 -->
          <div class="pillar-card">
            <div class="pillar-card-header">
              <span class="pillar-number">03</span>
              <i class="fas fa-shield-alt pillar-icon"></i>
            </div>
            <h3 class="pillar-title">Risk Management</h3>
            <div class="pillar-accent"></div>
            <p class="pillar-desc">Capital preservation is paramount. We define risk as permanent loss of capital &mdash; not short-term volatility. Every portfolio has hard risk limits built in.</p>
            <ul class="pillar-bullets">
              <li>Drawdown limits per strategy</li>
              <li>Continuous portfolio stress testing</li>
            </ul>
          </div>
          <!-- Pillar 4 -->
          <div class="pillar-card">
            <div class="pillar-card-header">
              <span class="pillar-number">04</span>
              <i class="fas fa-sign-out-alt pillar-icon"></i>
            </div>
            <h3 class="pillar-title">Exit Discipline</h3>
            <div class="pillar-accent"></div>
            <p class="pillar-desc">Knowing when to sell is as important as knowing what to buy. We exit when the thesis breaks, valuation becomes unreasonable, or better opportunities emerge.</p>
            <ul class="pillar-bullets">
              <li>Thesis-driven exit triggers</li>
              <li>Valuation discipline at entry and exit</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 3 — Investment Process Timeline -->
    <section class="investment-process" style="background-color: white; padding: 100px 0;">
      <div class="container">
        <div style="text-align: center; margin-bottom: 5rem;" class="reveal">
          <span style="color: #47a996; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 10px;">OUR PROCESS</span>
          <h2 style="color: #1A1A1A; font-size: 40px; font-weight: 700; margin-top:0; margin-bottom: 0;">From Idea to <span style="color: #496bad;">Portfolio Position.</span></h2>
        </div>

        <div class="timeline-wrapper reveal">
          <div class="timeline-line"></div>
          
          <div class="timeline-nodes">
            <div class="timeline-step">
              <div class="timeline-node">1</div>
              <h4 class="timeline-title">Idea Generation</h4>
              <p class="timeline-desc">Universe screening, thematic research, management interactions, peer referrals.</p>
            </div>
            <div class="timeline-step">
              <div class="timeline-node">2</div>
              <h4 class="timeline-title">Deep Dive Research</h4>
              <p class="timeline-desc">Financial modelling, site visits, scuttlebutt, risk identification.</p>
            </div>
            <div class="timeline-step">
              <div class="timeline-node">3</div>
              <h4 class="timeline-title">Investment Committee</h4>
              <p class="timeline-desc">Rigorous debate, devil's advocate review, final conviction scoring.</p>
            </div>
            <div class="timeline-step">
              <div class="timeline-node">4</div>
              <h4 class="timeline-title">Portfolio Entry</h4>
              <p class="timeline-desc">Position sizing, entry price discipline, phased buying strategy.</p>
            </div>
            <div class="timeline-step">
              <div class="timeline-node">5</div>
              <h4 class="timeline-title">Active Monitoring</h4>
              <p class="timeline-desc">Quarterly thesis review, management tracking, exit trigger monitoring.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 4 — ESG & Responsible Investing -->
    <section class="esg-section" style="background-color: #0A1628; padding: 80px 0;">
      <div class="container">
        <div class="esg-grid">
          <div class="esg-left reveal-left">
            <h2 class="esg-title">We Invest <span style="color: #47a996;">Responsibly.</span></h2>
            <p class="esg-desc">We integrate Environmental, Social, and Governance factors into our investment analysis &mdash; not as a checkbox, but as a genuine risk and opportunity lens. Companies with strong ESG practices tend to be better managed, more resilient, and more sustainable long-term compounders.</p>
            <a href="#" class="esg-link">Learn More About Our ESG Approach &rarr;</a>
          </div>
          <div class="esg-right reveal-right">
            <div class="esg-card">
              <i class="fas fa-leaf esg-icon"></i>
              <div class="esg-card-content">
                <h4 class="esg-card-title">Environmental</h4>
                <p class="esg-card-desc">Resource efficiency, carbon footprint mitigation, and ecological impact.</p>
              </div>
            </div>
            <div class="esg-card">
              <i class="fas fa-users esg-icon"></i>
              <div class="esg-card-content">
                <h4 class="esg-card-title">Social</h4>
                <p class="esg-card-desc">Labor practices, community relations, and supply chain ethics.</p>
              </div>
            </div>
            <div class="esg-card">
              <i class="fas fa-landmark esg-icon"></i>
              <div class="esg-card-content">
                <h4 class="esg-card-title">Governance</h4>
                <p class="esg-card-desc">Board independence, capital allocation discipline, and minority shareholder rights.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
"""

bottom_cta_html = """
    <!-- Pre-Footer CTA -->
    <section class="philosophy-cta" style="background-color: #0A1628; padding: 60px 0; border-top: 1px solid rgba(255,255,255,0.05); text-align: center;">
      <div class="container">
        <a href="performance.html" class="btn btn-primary" style="background-color: #496bad; border-color: #496bad; font-size: 16px; padding: 15px 30px;">See How Our Philosophy Translates to Performance &rarr;</a>
      </div>
    </section>
"""


# 1. Update about.html (Insert philosophy sections before team-hero-divider)
with open('about.html', 'r', encoding='utf-8') as f:
    about_content = f.read()

# I will also add id="firm-overview" to the top of the firm-overview block which is <section class="story-section">
# Wait, let's just make the top of about.html #firm-overview
about_content = about_content.replace('<section class="story-section">', '<section id="firm-overview" class="story-section">')
about_content = about_content.replace('<section class="leadership-section"', '<section id="leadership" class="leadership-section"')

team_divider_marker = '<!-- Team Mid-Page Divider (Hero Style) -->'
if team_divider_marker in about_content:
    about_content = about_content.replace(team_divider_marker, philosophy_html + "\\n    " + team_divider_marker)

# Replace Nav in about.html
old_nav_about = '''        <li class="nav-item">
          <a href="#">About Us <i class="fas fa-chevron-down" style="font-size:0.6rem;"></i></a>
          <ul class="dropdown-menu">
            <li><a href="about.html">Firm Overview</a></li>
            <li><a href="team.html">Leadership Team</a></li>
            <li><a href="philosophy.html">Investment Philosophy</a></li>
          </ul>
        </li>'''

new_nav = '''        <li class="nav-item">
          <a href="about.html">About Us <i class="fas fa-chevron-down" style="font-size:0.6rem;"></i></a>
          <ul class="dropdown-menu">
            <li><a href="about.html#firm-overview">Firm Overview</a></li>
            <li><a href="about.html#philosophy">Investment Philosophy</a></li>
            <li><a href="about.html#leadership">Leadership Team</a></li>
          </ul>
        </li>'''

about_content = about_content.replace(old_nav_about, new_nav)

with open('about.html', 'w', encoding='utf-8') as f:
    f.write(about_content)


# 2. Build standalone philosophy.html
# We'll use index.html to steal the header and footer
with open('index.html', 'r', encoding='utf-8') as f:
    index_content = f.read()

# Update nav in index.html too
index_content_updated = index_content.replace(old_nav_about, new_nav)
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(index_content_updated)

header_match = re.search(r'(.*?<main>)', index_content_updated, re.DOTALL)
footer_match = re.search(r'(</main>.*)', index_content_updated, re.DOTALL)

if header_match and footer_match:
    new_philosophy_content = header_match.group(1) + "\\n" + philosophy_html + bottom_cta_html + "\\n  " + footer_match.group(1)
    
    # Just to be sure, update the page title
    new_philosophy_content = new_philosophy_content.replace('<title>SPVH AMC | Institutional Wealth Management</title>', '<title>SPVH AMC | Investment Philosophy</title>')
    
    with open('philosophy.html', 'w', encoding='utf-8') as f:
        f.write(new_philosophy_content)
else:
    print("Could not extract header/footer from index.html")

print("Files updated successfully.")
