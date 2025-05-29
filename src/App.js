// Removed './App.css' import if all styles are handled by Tailwind or index.css
import HubSpotRelationshipMapper from './HubSpotRelationshipMapper';

function App() {
  return (
    // Apply Tailwind classes directly for basic app layout
    <div className="min-h-screen bg-gray-100 flex flex-col items-center pt-8">
      <HubSpotRelationshipMapper />
    </div>
  );
}

export default App;