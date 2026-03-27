// Wait for DOM to load
document.addEventListener("DOMContentLoaded", () => {
    
    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Intersection Observer for scroll animations
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const scrollObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                // Optional: Stop observing once illuminated
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    const revealElements = document.querySelectorAll('.reveal-scroll, .fade-in-scroll');
    revealElements.forEach(el => scrollObserver.observe(el));

    // Simple interaction for the hero mockup
    const captionBar = document.querySelector('.caption-bar .caption-text');
    const texts = [
        "Known phrase -> whole sign playback",
        "Unknown name -> fingerspelling fallback",
        "Relay server syncs captions between both sides",
        "Speaker gets subtitles, signer gets ASL playback"
    ];
    let arrIndex = 0;

    // Reset the CSS animation to keep the typing effect dynamic
    setInterval(() => {
        if(captionBar) {
            captionBar.style.animation = 'none';
            captionBar.offsetHeight; /* trigger reflow */
            captionBar.style.animation = null; 
            
            arrIndex++;
            if(arrIndex >= texts.length) arrIndex = 0;
            captionBar.innerText = texts[arrIndex];
        }
    }, 4500);
});
