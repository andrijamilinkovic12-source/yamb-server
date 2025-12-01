export class ModalSystem {
    constructor() {
        this.overlay = document.getElementById('universal-modal');
        this.title = document.getElementById('univ-title');
        this.msg = document.getElementById('univ-msg');
        this.inpContainer = document.getElementById('univ-input-container');
        this.inp = document.getElementById('univ-input');
        this.btnContainer = document.getElementById('univ-btns');
    }

    reset() {
        this.overlay.classList.add('hidden');
        this.inpContainer.classList.add('hidden');
        this.btnContainer.innerHTML = '';
        this.inp.value = '';
    }

    show(title, msg, type = 'alert', placeholder = '') {
        return new Promise((resolve) => {
            this.reset();
            this.title.innerText = title;
            this.msg.innerText = msg;
            this.overlay.classList.remove('hidden');

            if (type === 'prompt') {
                this.inpContainer.classList.remove('hidden');
                this.inp.placeholder = placeholder;
                this.inp.focus();
            }

            const btnOk = document.createElement('button');
            btnOk.className = 'u-modal-btn u-btn-ok';
            btnOk.innerText = type === 'confirm' ? 'DA' : 'OK';
            
            btnOk.onclick = () => {
                const val = this.inp.value;
                this.reset();
                if (type === 'prompt') resolve(val);
                else resolve(true);
            };

            this.btnContainer.appendChild(btnOk);

            if (type === 'confirm' || type === 'prompt') {
                const btnCancel = document.createElement('button');
                btnCancel.className = 'u-modal-btn u-btn-cancel';
                btnCancel.innerText = 'ODUSTANI';
                btnCancel.onclick = () => {
                    this.reset();
                    resolve(type === 'prompt' ? null : false);
                };
                this.btnContainer.insertBefore(btnCancel, btnOk);
            }
        });
    }

    alert(title, msg) { return this.show(title, msg, 'alert'); }
    confirm(title, msg) { return this.show(title, msg, 'confirm'); }
    prompt(title, msg, placeholder) { return this.show(title, msg, 'prompt', placeholder); }
}