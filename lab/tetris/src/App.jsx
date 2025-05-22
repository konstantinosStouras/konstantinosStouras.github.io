import React from "react";
import "./styles.css";

const GRID_SIZE = 8;

function App() {
  return (
    <div className="page">
      <div className="game-container">
        <div className="grid">
          {[...Array(GRID_SIZE * GRID_SIZE)].map((_, idx) => (
            <div key={idx} className="cell" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
