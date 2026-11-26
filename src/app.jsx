
import { useState } from "react";

export default function App() {
  const [musicEnabled, setMusicEnabled] = useState(false);

  return (
    <main className="website">
      <nav className="navbar">
        <a className="logo" href="#">FVREVER<span>.</span></a>

        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#gallery">Gallery</a>
          <a href="#changelog">Changelog</a>
        </div>

        <button className="nav-download" onClick={() => document.getElementById("download").scrollIntoView({ behavior: "smooth" })}>
          Download
        </button>
      </nav>

      <section className="hero">
        <div className="hero-content">
          <span className="eyebrow">✿ YOUR GAMING EXPERIENCE</span>
          <h1>A little more<br /><span>magic</span> in your world.</h1>
          <p>
            Discover FVREVER Launcher. A cozy place for your
            gaming experience, built with love.
          </p>

          <div className="hero-buttons">
            <a href="#download" className="primary-button">Get FVREVER ↗</a>
            <a href="#features" className="secondary-button">Discover more</a>
          </div>

          <div className="hero-note">✿ Made with love, for the community</div>
        </div>

        <div className="hero-decoration">✿</div>
      </section>

      <section id="features" className="features">
        <span className="eyebrow">WHAT MAKES IT SPECIAL</span>
        <h2>A better way to experience your games.</h2>

        <div className="feature-grid">
          <article>
            <span>🌸</span>
            <h3>A cozy experience</h3>
            <p>A beautiful and welcoming interface.</p>
          </article>
          <article>
            <span>⚡</span>
            <h3>Easy to use</h3>
            <p>Everything you need in one launcher.</p>
          </article>
          <article>
            <span>💗</span>
            <h3>Made with care</h3>
            <p>Created with the community in mind.</p>
          </article>
        </div>
      </section>

      <section id="gallery" className="gallery">
        <span className="eyebrow">A GLIMPSE OF FVREVER</span>
        <h2>Take a look around.</h2>
        <p>Discover the launcher and its features.</p>
      </section>

      <section id="changelog" className="changelog">
        <span className="eyebrow">WHAT'S NEW</span>
        <h2>Latest updates.</h2>
        <p>Stay up to date with the latest FVREVER releases.</p>
      </section>

      <section id="download" className="download">
        <span className="eyebrow">YOUR NEXT ADVENTURE</span>
        <h2>Ready to join FVREVER?</h2>
        <p>Get access to the latest launcher release.</p>
        <button className="primary-button" onClick={() => alert("Download access will be available soon!")}>
          Get access ↗
        </button>
      </section>

      <footer>
        <span>FVREVER<span className="pink">.</span></span>
        <p>Made with ♡ for the community.</p>
        <button className="music-button" onClick={() => setMusicEnabled(!musicEnabled)}>
          {musicEnabled ? "♫ Music enabled" : "♫ Music disabled"}
        </button>
      </footer>
    </main>
  );
}
