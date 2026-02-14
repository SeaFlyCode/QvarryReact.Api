/**
 * Vérifie si une adresse email est valide
 * @param email L'adresse email à vérifier
 * @returns Un objet avec isValid (booléen) et message (string)
 */
export function validateEmail(email: string): { isValid: boolean; message: string } {
    // Vérifier le format de base de l'email avec une regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return { 
            isValid: false, 
            message: "Format d'adresse email invalide." 
        };
    }

    // Vérifier que l'email contient un nom de domaine valide avec un TLD
    const parts = email.split('@');
    const domain = parts[1];
    
    // Vérifier le nom de domaine
    if (!domain.includes('.')) {
        return { 
            isValid: false, 
            message: "Le domaine de l'email est invalide." 
        };
    }

    // Vérifier la longueur du nom de domaine
    const domainParts = domain.split('.');
    if (domainParts[domainParts.length - 1].length < 2) {
        return { 
            isValid: false, 
            message: "L'extension du domaine est invalide." 
        };
    }

    // Vérifier les domaines jetables courants
    const disposableDomains = [
        'yopmail.com', 'tempmail.com', 'guerrillamail.com', 
        'mailinator.com', 'throwawaymail.com'
    ];
    
    if (disposableDomains.includes(domain.toLowerCase())) {
        return { 
            isValid: false, 
            message: "Les adresses email temporaires ne sont pas acceptées." 
        };
    }

    return { isValid: true, message: "Adresse email valide." };
}