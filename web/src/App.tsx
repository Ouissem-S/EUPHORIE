import Tv from "./pages/Tv";
import Control from "./pages/Control";
import Phone from "./pages/Phone";
import GlowFrame from "./components/GlowFrame";

export default function App() {
    const path = location.pathname.replace(/\/$/, "");
    if (path === "/tv") return <Tv />;
    if (path === "/control") return <Control />;
    if (path === "/phone") return <Phone />;
    return (
        <main className="landing preshow centred">
            <GlowFrame />
            <div className="preshow-left">
                <p className="intro-text">euphorie</p>
                <a className="start-btn" href={"/tv" + location.search}>
                    open the tv screen
                </a>
            </div>
        </main>
    );
}