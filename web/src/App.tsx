import Tv from "./pages/Tv";
import Control from "./pages/Control";

export default function App() {
    const path = location.pathname.replace(/\/$/, "");
    if (path === "/tv") return <Tv />;
    if (path === "/control") return <Control />;
    return (
        <main className="landing">
            <h1>EUPHORIE</h1>
            <p>Be in the crowd, from your living room.</p>
            <a href="/tv">Open the TV screen</a>
        </main>
    );
}