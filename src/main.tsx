import { render } from 'solid-js/web';
import App from './App';
import './styles/fonts.css';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');
render(() => <App />, root);
